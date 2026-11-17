import { createAttachmentKey } from 'svelte/attachments';

/**
 * Stand-ins for a remote `query()` and `form()` that keep kit's optimistic
 * contract: `withOverride` changes what the query reads at once, the form's
 * `.updates()` takes the release functions, and the submission releases them
 * when it settles either way. A form here is held until the spec answers it.
 */

export function fakeQuery<T>(initial: T) {
	let raw = $state.raw(initial);
	const overrides = $state<((value: T) => T)[]>([]);
	const read = () => overrides.reduce((v, fn) => fn(v), raw);

	const resource = {
		get current() {
			return read();
		},
		// A getter, as in kit: `await` reads it synchronously, so the awaiting
		// derived re-runs when an override arrives or leaves.
		get then() {
			const value = read();
			return (resolve: (v: T) => unknown, reject?: (e: unknown) => unknown) =>
				Promise.resolve(value).then(resolve, reject);
		},
		withOverride(fn: (value: T) => T) {
			overrides.push(fn);
			return () => {
				const i = overrides.indexOf(fn);
				if (i !== -1) overrides.splice(i, 1);
			};
		},
		set(value: T) {
			raw = value;
		},
		refresh: () => Promise.resolve()
	};
	// Every argument reads the one resource; `.resource` is it, for the spec.
	return Object.assign((..._args: unknown[]) => resource, { resource });
}

interface Held {
	resolve(ok?: boolean): void;
	reject(err: unknown): void;
	updates: unknown[];
	/** Resolves once the submission has released its overrides. */
	settled: Promise<unknown>;
}

export function heldRemoteForm() {
	let callback: ((instance: { submit: () => unknown }) => unknown) | null = null;
	const held: Held[] = [];
	const instance: Record<string | symbol, unknown> = { method: 'POST', action: '?/fake' };

	function submit() {
		let release: (() => void)[] = [];
		const entry = { updates: [] as unknown[] } as unknown as Held;
		const done = new Promise<boolean>((resolve, reject) => {
			entry.resolve = (ok = true) => resolve(ok);
			entry.reject = reject;
		}).finally(() => release.forEach((fn) => fn()));
		entry.settled = done.catch(() => undefined);
		held.push(entry);
		return Object.assign(done, {
			updates(...args: unknown[]) {
				entry.updates = args;
				release = args.filter((a): a is () => void => typeof a === 'function');
				return done;
			}
		});
	}

	instance[createAttachmentKey()] = (form: HTMLFormElement) => {
		const onsubmit = (event: SubmitEvent) => {
			event.preventDefault();
			void callback?.({ submit });
		};
		form.addEventListener('submit', onsubmit);
		return () => form.removeEventListener('submit', onsubmit);
	};

	const field = (name: string) => ({
		as: (type: string, value?: unknown) => ({ type, name, value }),
		issues: () => null,
		value: () => undefined
	});
	Object.defineProperties(instance, {
		fields: {
			value: new Proxy({} as Record<string, unknown>, {
				get: (_, key) => (key === 'allIssues' ? () => null : field(String(key)))
			})
		},
		result: { value: undefined, writable: true },
		pending: { value: 0 },
		held: { value: held },
		enhance: {
			value: (cb: typeof callback) => {
				callback = cb;
				return instance;
			}
		}
	});
	Object.defineProperty(instance, 'for', { value: () => instance });
	/** Answers whatever a spec left in flight, so its overrides do not leak. */
	async function settleAll() {
		held.forEach((h) => h.resolve());
		await Promise.all(held.map((h) => h.settled));
		held.length = 0;
	}
	Object.defineProperty(instance, 'settleAll', { value: settleAll });
	return instance as typeof instance & { held: Held[]; settleAll: typeof settleAll };
}
