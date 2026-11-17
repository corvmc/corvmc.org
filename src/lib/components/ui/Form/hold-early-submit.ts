type Attach = (form: HTMLFormElement) => (() => void) | void;
type Entry = { form: HTMLFormElement; cleanup: (() => void) | void };

// Keyed by kit's attachment, which is one per form instance.
const live = new WeakMap<Attach, Entry>();

function attachOnce(inner: Attach, form: HTMLFormElement): Entry {
	const prev = live.get(inner);
	if (prev?.form === form) return prev;
	// An early attach whose effect never ran has no teardown of its own.
	if (prev && !prev.form.isConnected) {
		live.delete(inner);
		prev.cleanup?.();
	}
	const entry = { form, cleanup: inner(form) };
	live.set(inner, entry);
	return entry;
}

/**
 * Kit adds a remote form's submit listener from an attachment, and Svelte runs
 * attachments as effects. An effect can run late, or not at all, while the form
 * is already on screen, and a click then posts the whole document (#3218). A
 * submit that arrives first attaches kit itself and is replayed through it.
 */
export function holdEarlySubmits<T extends object>(attrs: T) {
	let attached = false;
	const inners: Attach[] = [];

	const descriptors = Object.getOwnPropertyDescriptors(attrs) as Record<
		PropertyKey,
		PropertyDescriptor
	>;
	for (const key of Object.getOwnPropertySymbols(descriptors)) {
		const inner = descriptors[key].value;
		if (typeof inner !== 'function') continue;
		inners.push(inner);
		descriptors[key].value = (form: HTMLFormElement) => {
			const entry = attachOnce(inner, form);
			attached = true;
			return () => {
				attached = false;
				if (live.get(inner) !== entry) return;
				live.delete(inner);
				entry.cleanup?.();
			};
		};
	}

	return {
		attrs: Object.defineProperties({}, descriptors) as T,
		/** Call from a capture-phase submit handler; true means it was taken over. */
		hold(e: SubmitEvent): boolean {
			if (attached || inners.length === 0) return false;
			const form = e.currentTarget as HTMLFormElement;
			e.preventDefault();
			e.stopImmediatePropagation();
			for (const inner of inners) attachOnce(inner, form);
			attached = true;
			const submitter = e.submitter as HTMLElement | null;
			queueMicrotask(() => {
				if (!form.isConnected) return;
				form.requestSubmit(submitter && form.contains(submitter) ? submitter : undefined);
			});
			return true;
		}
	};
}
