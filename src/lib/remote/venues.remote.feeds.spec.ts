import { describe, it, expect, vi, beforeEach } from 'vitest';
import { error } from '@sveltejs/kit';

/** The feed remotes guard on `event.manage` before they touch the service. */

const requireCapability = vi.fn(async (_cap: string) => ({ id: 'staff-1' }));
vi.mock('$lib/server/authorization', () => ({
	requireCapability: (cap: string) => requireCapability(cap)
}));

const service = {
	addSource: vi.fn(async () => ({ id: 'src-1', venueId: 'v-1' })),
	setSourcePaused: vi.fn(async () => ({ venueId: 'v-1' })),
	removeSource: vi.fn(async () => ({ venueId: 'v-1' })),
	fetchSourceNow: vi.fn(async () => ({
		venueId: 'v-1',
		result: { sourceId: 'src-1', ok: true, inserted: 2, updated: 1, skipped: 0 }
	})),
	listSourcesForVenue: vi.fn(async () => [])
};
vi.mock('$lib/server/venue/calendar-source-service', () => service);
vi.mock('$lib/server/venue/venue-service', () => ({}));

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({ locals: { user: null }, request: { headers: new Headers() } }),
	// Stubbed wholesale: a query here is only ever refreshed.
	query: () => Object.assign(() => ({ refresh: async () => undefined }), { __: { type: 'query' } }),
	command: (...args: unknown[]) => tag(args, 'command'),
	form: (...args: unknown[]) => tag(args, 'form')
}));

function tag(args: unknown[], type: string) {
	const handler = args.at(-1) as Record<string, unknown>;
	handler.__ = { type };
	return handler;
}

const remotes = (await import('./venues.remote')) as unknown as Record<
	string,
	(data: unknown) => Promise<unknown>
>;

beforeEach(() => {
	vi.clearAllMocks();
});

describe('venue feed remotes', () => {
	it('adds a feed as the calling staffer', async () => {
		await remotes.addVenueFeed({ venueId: 'v-1', url: 'https://x.example/cal.ics' });

		expect(requireCapability).toHaveBeenCalledWith('event.manage');
		expect(service.addSource).toHaveBeenCalledWith({
			venueId: 'v-1',
			url: 'https://x.example/cal.ics',
			createdByUserId: 'staff-1'
		});
	});

	it('reports a fetch-now run as counts', async () => {
		expect(await remotes.fetchVenueFeed({ id: 'src-1' })).toEqual({
			ok: true,
			inserted: 2,
			updated: 1
		});
	});

	it.each([
		['addVenueFeed', { venueId: 'v-1', url: 'https://x.example/cal.ics' }],
		['setVenueFeedPaused', { id: 'src-1', paused: 'true' }],
		['removeVenueFeed', { id: 'src-1' }],
		['fetchVenueFeed', { id: 'src-1' }]
	])('%s refuses without event.manage and never reaches the service', async (name, data) => {
		requireCapability.mockImplementationOnce(async () => error(403, 'Not permitted'));

		await expect(remotes[name](data)).rejects.toMatchObject({ status: 403 });
		for (const fn of Object.values(service)) expect(fn).not.toHaveBeenCalled();
	});
});
