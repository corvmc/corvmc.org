import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The search over every listing, bill or no bill, that commissioning an artist
 * needs. It returns hidden external entries by name, so it is a staff read.
 */

const requireCapability = vi.fn<(cap: string) => Promise<unknown>>();
vi.mock('#lib/server/authorization.js', () => ({
	requireCapability: (cap: string) => requireCapability(cap),
	requireUser: () => ({ id: 'booker-1' })
}));

const searchAskableEntries = vi.fn(async (q: string) => [{ id: 'e-1', name: q }]);
vi.mock('#lib/server/production/artifact-request-service.js', () => ({
	searchAskableEntries: (q: string) => searchAskableEntries(q)
}));
const searchOutsideActs = vi.fn(async () => [{ id: 'entry-h', name: 'Harbor Lights' }]);
vi.mock('#lib/server/directory/entry-service.js', () => ({
	searchOutsideActs: () => searchOutsideActs()
}));
const searchBandsByName = vi.fn(async () => [{ id: 'band-1', name: 'Harbor Wolves' }]);
vi.mock('#lib/server/band/band-service.js', () => ({
	searchBandsByName: () => searchBandsByName()
}));
const getCreditEventId = vi.fn(async (id: string) => (id === 'credit-1' ? 'evt-show' : null));
const listCreditInDirectory = vi.fn(async () => 'entry-1');
vi.mock('#lib/server/event/event-service.js', () => ({
	getCreditEventId: (id: string) => getCreditEventId(id),
	listCreditInDirectory: () => listCreditInDirectory()
}));
const requireListingWriter = vi.fn<(eventId: string) => Promise<unknown>>();
vi.mock('#lib/server/event/listing-guard.js', () => ({
	requireListingWriter: (eventId: string) => requireListingWriter(eventId)
}));

// Kit refuses a `.remote.ts` export without the `__` marker a real remote has.
function remote(type: string, run: (arg: unknown) => unknown = () => undefined) {
	return Object.assign((arg: unknown) => run(arg), { __: { type } });
}
vi.mock('$app/server', () => ({
	query: (schema: { parse: (v: unknown) => unknown }, handler: (v: unknown) => unknown) =>
		remote('query', (arg) => handler(schema.parse(arg)))
}));
vi.mock('./_remote', () => ({
	form: (_schema: unknown, handler: (v: unknown) => unknown) => remote('form', handler)
}));

const {
	searchAskableListings,
	searchBillActs,
	listActInDirectory: listActForm
} = await import('./external-acts.remote');
// The mocked `form` hands back the handler; kit's type says it is not callable.
const listActInDirectory = listActForm as unknown as (data: {
	eventBandId: string;
}) => Promise<unknown>;

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

describe('searchBillActs (#2782)', () => {
	it('offers bands and outside acts to whoever may write the listing', async () => {
		requireListingWriter.mockResolvedValueOnce({ id: 'booker-1' });
		expect(await searchBillActs({ eventId: 'evt-show', q: 'harbor' })).toEqual([
			{ id: 'band-1', name: 'Harbor Wolves', kind: 'band' },
			{ id: 'entry-h', name: 'Harbor Lights', kind: 'act' }
		]);
		expect(requireListingWriter).toHaveBeenCalledWith('evt-show');
	});

	it('searches nothing for someone the listing refuses', async () => {
		requireListingWriter.mockRejectedValueOnce(new Error('403'));
		await expect(searchBillActs({ eventId: 'evt-show', q: 'harbor' })).rejects.toThrow('403');
		expect(searchOutsideActs).not.toHaveBeenCalled();
	});
});

describe('listActInDirectory (#2780)', () => {
	it("guards on the credit's own show, read off the row", async () => {
		requireListingWriter.mockResolvedValueOnce({ id: 'booker-1' });
		expect(await listActInDirectory({ eventBandId: 'credit-1' })).toEqual({
			success: true,
			entryId: 'entry-1'
		});
		expect(requireListingWriter).toHaveBeenCalledWith('evt-show');
	});

	it('lists nothing for someone the show refuses', async () => {
		requireListingWriter.mockRejectedValueOnce(new Error('403'));
		await expect(listActInDirectory({ eventBandId: 'credit-1' })).rejects.toThrow('403');
		expect(listCreditInDirectory).not.toHaveBeenCalled();
	});

	it('404s a credit that does not exist, before any guard', async () => {
		await expect(listActInDirectory({ eventBandId: 'gone' })).rejects.toMatchObject({
			status: 404
		});
		expect(requireListingWriter).not.toHaveBeenCalled();
	});
});
