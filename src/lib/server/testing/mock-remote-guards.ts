/**
 * Stand-ins for `$app/server` and the capability guards, for a spec asking
 * whether a remote function refuses a viewer. Each remote becomes its bare
 * handler, marked so kit's export check accepts it; schemas are not run.
 */
const remote =
	(type: string) =>
	(...args: unknown[]) => {
		const handler = args.at(-1) as (...a: unknown[]) => unknown;
		return Object.assign((...a: unknown[]) => handler(...a), { __: { type } });
	};

export const appServerMock = () => ({
	getRequestEvent: () => ({ locals: { user: { id: 'usr-1' } }, url: new URL('http://x/') }),
	query: Object.assign(remote('query'), { batch: remote('query_batch') }),
	form: remote('form'),
	command: remote('command'),
	prerender: remote('prerender')
});

/** Guards that answer from `held`. A refusal carries the 403 `requireCapability` throws. */
export const guardsFor = (held: () => string[]) => ({
	can: async (cap: string) => held().includes(cap),
	requireCapability: async (cap: string) => {
		if (!held().includes(cap)) throw Object.assign(new Error('forbidden'), { status: 403 });
		return { id: 'usr-1' };
	}
});
