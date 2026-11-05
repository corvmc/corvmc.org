import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAudience, deleteAudience, getAudienceList } from './marketing.remote';

// Kit's `refresh()` starts the query inside the form request, under the
// caller's own capabilities, and sends its result back to the page that asked.
const { auth, refreshes } = vi.hoisted(() => ({
	auth: { held: [] as string[] },
	refreshes: [] as { query: unknown; outcome: Promise<unknown> }[]
}));

vi.mock('#lib/server/authorization.js', async () =>
	(await import('#lib/server/testing/mock-remote-guards.js')).guardsFor(() => auth.held)
);
vi.mock('$app/server', async () => {
	const { appServerMock } = await import('#lib/server/testing/mock-remote-guards.js');
	const query = (...args: unknown[]) => {
		const handler = args.at(-1) as (...a: unknown[]) => Promise<unknown>;
		const remote = (...a: unknown[]) => ({
			refresh: async () => {
				const outcome = handler(...a);
				outcome.catch(() => {});
				refreshes.push({ query: remote, outcome });
			}
		});
		return Object.assign(remote, { __: { type: 'query' } });
	};
	return { ...appServerMock(), query };
});
vi.mock('#lib/server/marketing/audience-service.js', () => ({
	listAudiences: vi.fn(async () => []),
	createAudience: vi.fn(async () => ({ id: 'aud-1' })),
	deleteAudience: vi.fn(async () => undefined)
}));
vi.mock('#lib/server/marketing/campaign-service.js', () => ({}));
vi.mock('#lib/server/marketing/unsubscribe.js', () => ({}));
vi.mock('#lib/server/marketing/subscriber-service.js', () => ({}));
vi.mock('#lib/server/turnstile.js', () => ({}));
vi.mock('#lib/server/utils/slug.js', () => ({
	generateSlug: () => 'slug',
	ensureUniqueSlug: async () => 'slug'
}));
vi.mock('#lib/server/db/index.js', () => ({ db: {} }));

const writes: [string, () => unknown][] = [
	[
		'createAudience',
		() => (createAudience as never as (d: object, i: object) => unknown)({ name: 'New' }, {})
	],
	['deleteAudience', () => (deleteAudience as never as (d: object) => unknown)({ id: 'aud-1' })]
];

beforeEach(() => {
	refreshes.length = 0;
});

describe.each(writes)('%s', (_name, write) => {
	it('refreshes the list the Audiences tab renders, and nothing else', async () => {
		auth.held = ['marketing.manageAudiences', 'marketing.read'];
		await write();
		expect(refreshes.map((r) => r.query)).toEqual([getAudienceList]);
	});

	it('refreshes nothing that refuses a holder of audience management alone', async () => {
		auth.held = ['marketing.manageAudiences'];
		await write();
		expect(refreshes.length).toBeGreaterThan(0);
		await Promise.all(refreshes.map((r) => expect(r.outcome).resolves.toBeDefined()));
	});
});
