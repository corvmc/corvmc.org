import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The search over every listing, bill or no bill, that commissioning an artist
 * needs. It returns hidden external entries by name, so it is a staff read.
 */

const requireCapability = vi.fn<(cap: string) => Promise<unknown>>();
vi.mock('$lib/server/authorization', () => ({
	requireCapability: (cap: string) => requireCapability(cap)
}));

const searchAskableEntries = vi.fn(async (q: string) => [{ id: 'e-1', name: q }]);
vi.mock('$lib/server/production/artifact-request-service', () => ({
	searchAskableEntries: (q: string) => searchAskableEntries(q)
}));
vi.mock('$lib/server/directory/entry-service', () => ({}));
vi.mock('$lib/server/event/event-service', () => ({}));

// Kit refuses a `.remote.ts` export without the `__` marker a real remote has.
function remote(type: string, run: (arg: unknown) => unknown = () => undefined) {
	return Object.assign((arg: unknown) => run(arg), { __: { type } });
}
vi.mock('$app/server', () => ({
	query: (schema: { parse: (v: unknown) => unknown }, handler: (v: unknown) => unknown) =>
		remote('query', (arg) => handler(schema.parse(arg)))
}));
vi.mock('./_remote', () => ({ form: () => remote('form') }));

const { searchAskableListings } = await import('./external-acts.remote');

beforeEach(() => {
	vi.clearAllMocks();
});

describe('searchAskableListings', () => {
	it('requires event.manage before searching', async () => {
		requireCapability.mockRejectedValueOnce(new Error('403'));
		await expect(searchAskableListings('ada')).rejects.toThrow('403');
		expect(requireCapability).toHaveBeenCalledWith('event.manage');
		expect(searchAskableEntries).not.toHaveBeenCalled();
	});

	it('searches once the caller may manage events', async () => {
		requireCapability.mockResolvedValueOnce({ id: 'staff-1' });
		expect(await searchAskableListings('ada')).toEqual([{ id: 'e-1', name: 'ada' }]);
	});
});
