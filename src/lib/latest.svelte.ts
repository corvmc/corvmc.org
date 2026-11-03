/**
 * The last value a promise-returning getter resolved to, kept while the next is
 * in flight. `{#await p}` re-pends on every new `p` — and a remote query hands
 * out a new one on each `refresh()`/`invalidateAll()` — destroying everything
 * inside it, open dialogs included (#2352). Render from `current` instead.
 *
 * Construct it during component init: it owns an `$effect`.
 */
export class Latest<T> {
	#value = $state.raw<{ v: T }>();
	#error = $state.raw<{ e: unknown }>();
	#loading = $state(true);

	constructor(get: () => PromiseLike<T>) {
		$effect(() => {
			let live = true;
			this.#loading = true;
			get().then(
				(v) => {
					if (!live) return;
					[this.#value, this.#error, this.#loading] = [{ v }, undefined, false];
				},
				(e) => {
					if (!live) return;
					[this.#error, this.#loading] = [{ e }, false];
				}
			);
			return () => (live = false);
		});
	}

	/** Undefined until the first resolve; then the latest resolved value. */
	get current(): T | undefined {
		return this.#value?.v;
	}

	/** True from each new promise until it settles. */
	get loading(): boolean {
		return this.#loading;
	}

	/** The latest rejection, boxed so a rejected `undefined` still reads as one. */
	get error(): { e: unknown } | undefined {
		return this.#error;
	}
}
