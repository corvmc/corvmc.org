import { describe, expect, it, vi } from 'vitest';

// A decision made from the dashboard feed posts to the remote form the kind's
// own page uses, so it is guarded by that form's first line. This walks every
// bound decision and pins that the first line asks for the capability the
// registry shows the kind under, and refuses before any service runs.

vi.mock('$app/server', () => {
	// A remote module checks that every export carries kit's `__` marker.
	const remote =
		(type: string) =>
		(...a: unknown[]) =>
			Object.assign(a.at(-1) as (...args: unknown[]) => unknown, { __: { type } });
	return {
		query: Object.assign(remote('query'), { batch: remote('query_batch') }),
		form: remote('form'),
		command: remote('command'),
		prerender: remote('prerender'),
		getRequestEvent: () => ({ locals: {}, url: new URL('http://localhost/') })
	};
});

const asked: string[] = [];
vi.mock('#lib/server/authorization.js', async (importOriginal) => {
	const { error } = await import('@sveltejs/kit');
	const refuse = (cap: string) => {
		asked.push(cap);
		error(403, 'Not permitted');
	};
	return {
		...(await importOriginal<object>()),
		requireCapability: async (cap: string) => refuse(cap),
		requireUser: () => error(401, 'Not signed in')
	};
});

vi.mock('#lib/server/db/index.js', () => ({ db: {} }));

const { reviewDecisionForms } = await import('./review-decisions');
const { reviewRegistry } = await import('#lib/server/review/review-registry.js');

const item = { subjectId: 's1', ref: { type: 'event' as const, id: 'r1', title: 'Fixture' } };

describe('feed-row decisions', () => {
	const cases = Object.entries(reviewDecisionForms).flatMap(([kind, bound]) =>
		Object.entries(bound).map(([decision, d]) => ({ kind, decision, d }))
	);

	it.each(cases)('$kind $decision asks for the kind’s capability first', async ({ kind, d }) => {
		asked.length = 0;
		const data = {
			...d.values(item),
			...('message' in d ? { [d.message]: 'Fixture reason' } : {})
		};
		const handler = d.form as unknown as (data: unknown, issue: unknown) => Promise<unknown>;
		await expect(handler(data, new Proxy({}, { get: () => () => ({}) }))).rejects.toMatchObject({
			status: 403
		});
		expect(asked[0]).toBe(reviewRegistry[kind as keyof typeof reviewRegistry].capability);
	});
});
