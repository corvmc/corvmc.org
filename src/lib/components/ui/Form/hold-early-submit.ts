type Attach = (form: HTMLFormElement) => (() => void) | void;

// Per element, not per wrapper: a derived re-read from an event handler can
// hand back a fresh wrapper that never ran, while the one in the DOM did.
const enhanced = new WeakSet<HTMLFormElement>();
const held = new WeakMap<HTMLFormElement, HTMLElement | null>();

/**
 * Kit adds a remote form's submit listener from an attachment, and Svelte runs
 * attachments as effects. While a sibling `await` keeps the batch pending, the
 * form can be on screen with no listener yet, so a click posts the document and
 * reloads the page (#3218). A submit in that window is held, then replayed.
 */
export function holdEarlySubmits<T extends object>(attrs: T): T {
	const descriptors = Object.getOwnPropertyDescriptors(attrs) as Record<
		PropertyKey,
		PropertyDescriptor
	>;
	for (const key of Object.getOwnPropertySymbols(descriptors)) {
		const inner = descriptors[key].value as Attach;
		if (typeof inner !== 'function') continue;
		descriptors[key].value = (form: HTMLFormElement) => {
			const cleanup = inner(form);
			enhanced.add(form);
			if (held.has(form)) {
				const submitter = held.get(form) ?? null;
				held.delete(form);
				queueMicrotask(() => {
					if (!form.isConnected) return;
					form.requestSubmit(submitter && form.contains(submitter) ? submitter : undefined);
				});
			}
			return () => {
				enhanced.delete(form);
				cleanup?.();
			};
		};
	}
	return Object.defineProperties({}, descriptors) as T;
}

/** Call from a capture-phase submit handler; true means the submit was held. */
export function holdIfNotEnhanced(e: SubmitEvent): boolean {
	const form = e.currentTarget as HTMLFormElement;
	if (enhanced.has(form)) return false;
	e.preventDefault();
	e.stopImmediatePropagation();
	held.set(form, e.submitter as HTMLElement | null);
	return true;
}
