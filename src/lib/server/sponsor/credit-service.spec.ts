import { describe, it, expect, vi, beforeEach } from 'vitest';

// Every select resolves to the next queued result, so a test states what each
// round trip returns in order rather than stubbing a query builder.
let results: unknown[][] = [];
const writes: string[] = [];

function chainable(kind: string) {
	const proxy: any = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				return (resolve: (v: unknown[]) => void) => resolve(results.shift() ?? []);
			}
			return () => proxy;
		}
	});
	if (kind !== 'select') writes.push(kind);
	return proxy;
}

vi.mock('$lib/server/db', () => ({
	db: {
		select: vi.fn(() => chainable('select')),
		insert: vi.fn(() => chainable('insert')),
		delete: vi.fn(() => chainable('delete'))
	}
}));

const uploadFile = vi.fn(async () => undefined);
vi.mock('$lib/server/storage', () => ({ uploadFile }));
const replaceSlot = vi.fn(async () => ({ mediaId: 'm1', attachmentId: 'a1' }));
const detachSlot = vi.fn(async () => undefined);
vi.mock('$lib/server/media/media-service', () => ({ replaceSlot, detachSlot }));

const {
	toCredits,
	placeSponsorship,
	removePlacement,
	setSponsorLogo,
	PlacementEmptyError,
	PlacementNotFoundError
} = await import('./credit-service');
const { SponsorNotFoundError, SponsorshipNotFoundError } = await import('./sponsor-service');

const row = (over: Partial<Parameters<typeof toCredits>[0][number]> = {}) => ({
	sponsorId: 's1',
	name: 'Troubadour Music',
	website: 'https://troubadour.example',
	status: 'active' as const,
	onEventPage: true,
	inCampaign: true,
	logoKey: null,
	...over
});

beforeEach(() => {
	results = [];
	writes.length = 0;
	vi.clearAllMocks();
});

describe('toCredits', () => {
	it('credits an active or finished term, never a pitch or a refusal', () => {
		const credits = toCredits(
			[
				row({ sponsorId: 'a', name: 'Active', status: 'active' }),
				row({ sponsorId: 'e', name: 'Ended', status: 'ended' }),
				row({ sponsorId: 'p', name: 'Pitched', status: 'prospect' }),
				row({ sponsorId: 'd', name: 'Declined', status: 'declined' })
			],
			'eventPage'
		);
		expect(credits.map((c) => c.name)).toEqual(['Active', 'Ended']);
	});

	it('reads only the flag for the surface asked about', () => {
		const rows = [
			row({ sponsorId: 'page', name: 'Page only', inCampaign: false }),
			row({ sponsorId: 'mail', name: 'Mail only', onEventPage: false })
		];
		expect(toCredits(rows, 'eventPage').map((c) => c.name)).toEqual(['Page only']);
		expect(toCredits(rows, 'campaign').map((c) => c.name)).toEqual(['Mail only']);
	});

	it('names a sponsor once when two of its terms cover the same show', () => {
		const credits = toCredits([row(), row({ status: 'ended' })], 'eventPage');
		expect(credits).toHaveLength(1);
	});

	it('sorts by name and carries the logo key through', () => {
		const credits = toCredits(
			[row({ sponsorId: 'z', name: 'Zed' }), row({ sponsorId: 'a', name: 'Acme', logoKey: 'k' })],
			'eventPage'
		);
		expect(credits).toEqual([
			{ sponsorId: 'a', name: 'Acme', website: 'https://troubadour.example', logoKey: 'k' },
			{ sponsorId: 'z', name: 'Zed', website: 'https://troubadour.example', logoKey: null }
		]);
	});
});

describe('placeSponsorship', () => {
	const input = { sponsorshipId: 'p1', eventId: 'e1', onEventPage: true, inCampaign: false };

	it('refuses a placement that credits nowhere, before any query', async () => {
		await expect(
			placeSponsorship({ ...input, onEventPage: false, inCampaign: false })
		).rejects.toBeInstanceOf(PlacementEmptyError);
		expect(writes).toEqual([]);
	});

	it('refuses a sponsorship that does not exist', async () => {
		results = [[], [{ id: 'e1' }]];
		await expect(placeSponsorship(input)).rejects.toBeInstanceOf(SponsorshipNotFoundError);
		expect(writes).toEqual([]);
	});

	it('refuses an event that does not exist', async () => {
		results = [[{ id: 'p1' }], []];
		await expect(placeSponsorship(input)).rejects.toThrow('Event not found');
		expect(writes).toEqual([]);
	});

	it('writes once both ends exist', async () => {
		results = [[{ id: 'p1' }], [{ id: 'e1' }]];
		await placeSponsorship(input);
		expect(writes).toEqual(['insert']);
	});
});

describe('removePlacement', () => {
	it('reports a placement that was already gone', async () => {
		results = [[]];
		await expect(removePlacement('x')).rejects.toBeInstanceOf(PlacementNotFoundError);
	});
});

describe('setSponsorLogo', () => {
	const file = { buffer: new ArrayBuffer(4), contentType: 'image/png', filename: 'logo.png' };

	it('refuses an unknown sponsor before uploading anything', async () => {
		results = [[]];
		await expect(setSponsorLogo('nope', file, 'u1')).rejects.toBeInstanceOf(SponsorNotFoundError);
		expect(uploadFile).not.toHaveBeenCalled();
	});

	it("points the sponsor's logo slot at the uploaded object", async () => {
		results = [[{ id: 's1' }]];
		await setSponsorLogo('s1', file, 'u1');
		expect(uploadFile).toHaveBeenCalledOnce();
		expect(replaceSlot).toHaveBeenCalledWith(
			expect.objectContaining({ attachableType: 'sponsor', attachableId: 's1', slot: 'logo' })
		);
	});
});
