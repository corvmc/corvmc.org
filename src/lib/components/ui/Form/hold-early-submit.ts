/**
 * Kit adds a remote form's submit listener from an attachment, and Svelte runs
 * attachments as effects. While a sibling `await` keeps the batch pending, the
 * form can be on screen and clickable with no listener yet, so a click posts
 * the document natively and reloads the page (#3218). This wraps the
 * attachments so a submit in that window is held and replayed once they run.
 */
export function holdEarlySubmits<T extends object>(attrs: T) {
	let attached = false;
	let held: { submitter: HTMLElement | null } | null = null;

	const descriptors = Object.getOwnPropertyDescriptors(attrs);
	for (const key of Object.getOwnPropertySymbols(descriptors)) {
		const inner = descriptors[key as unknown as keyof typeof descriptors].value;
		if (typeof inner !== 'function') continue;
		descriptors[key as unknown as keyof typeof descriptors].value = (form: HTMLFormElement) => {
			const cleanup = inner(form);
			attached = true;
			if (held) {
				const { submitter } = held;
				held = null;
				queueMicrotask(() => {
					if (!form.isConnected) return;
					form.requestSubmit(submitter && form.contains(submitter) ? submitter : undefined);
				});
			}
			return () => {
				attached = false;
				cleanup?.();
			};
		};
	}

	return {
		attrs: Object.defineProperties({}, descriptors) as T,
		/** Call from a capture-phase submit handler; true means the event was held. */
		hold(e: SubmitEvent): boolean {
			if (attached) return false;
			e.preventDefault();
			e.stopImmediatePropagation();
			held = { submitter: e.submitter as HTMLElement | null };
			return true;
		}
	};
}
