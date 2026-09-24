import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Wishlist pledges (#1492): "I'll bring the bass amp". What matters is that a
 * pledge holds an entry for a while and then lets go on its own, that only the
 * pledger can release it, and that an arrival closes the right ones.
 */

let selectResults: unknown[][] = [];
let inserted: unknown[] = [];
let updateCalls: { values: unknown }[] = [];

function chain(): unknown {
	const proxy: unknown = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				return (resolve: (v: unknown[]) => void) =>
					resolve(selectResults.length > 0 ? selectResults.shift()! : []);
			}
			return () => proxy;
		}
	});
	return proxy;
}

vi.mock('$lib/server/db', () => ({
	db: {
		select: vi.fn(() => chain()),
		insert: vi.fn(() => ({
			values: (v: unknown) => {
				inserted.push(v);
				return Promise.resolve([]);
			}
		})),
		update: vi.fn(() => ({
			set: (values: unknown) => {
				updateCalls.push({ values });
				return { where: () => Promise.resolve([]) };
			}
		}))
	}
}));

const {
	PLEDGE_DAYS,
	claimFor,
	pledgeEntry,
	releasePledge,
	fulfilPledges,
	PledgeTakenError,
	PledgeNotFoundError
} = await import('./pledge-service');

const NOW = new Date('2026-09-23T12:00:00Z');
const later = (days: number) => new Date(NOW.getTime() + days * 86_400_000);

beforeEach(() => {
	selectResults = [];
	inserted = [];
	updateCalls = [];
});

describe('claimFor', () => {
	const pledges = [
		{ subjectType: 'suggestion' as const, subjectId: 's-1', userId: 'u-1' },
		{ subjectType: 'item' as const, subjectId: 'i-1', userId: 'u-2' }
	];

	it('says nobody has claimed an entry with no live pledge', () => {
		expect(claimFor(pledges, 'suggestion', 's-9', 'u-1')).toBe('none');
	});

	it('tells the pledger it is theirs, and everyone else only that it is taken', () => {
		expect(claimFor(pledges, 'suggestion', 's-1', 'u-1')).toBe('you');
		expect(claimFor(pledges, 'suggestion', 's-1', 'u-2')).toBe('someone');
		expect(claimFor(pledges, 'suggestion', 's-1', undefined)).toBe('someone');
	});

	it('does not confuse a gear id with a supply id', () => {
		expect(claimFor(pledges, 'item', 's-1', 'u-1')).toBe('none');
	});
});

describe('pledgeEntry', () => {
	it(`holds the entry for ${PLEDGE_DAYS} days`, async () => {
		selectResults = [[]];
		await pledgeEntry({ userId: 'u-1', subjectType: 'item', subjectId: 'i-1', now: NOW });

		expect(inserted).toHaveLength(1);
		expect(inserted[0]).toMatchObject({
			userId: 'u-1',
			subjectType: 'item',
			subjectId: 'i-1',
			status: 'open',
			expiresAt: later(PLEDGE_DAYS)
		});
	});

	it('refuses an entry someone else already holds', async () => {
		selectResults = [[{ id: 'p-1', userId: 'u-2' }]];
		await expect(
			pledgeEntry({ userId: 'u-1', subjectType: 'item', subjectId: 'i-1', now: NOW })
		).rejects.toThrow(PledgeTakenError);
		expect(inserted).toHaveLength(0);
	});

	it('is a no-op when the caller already holds it', async () => {
		selectResults = [[{ id: 'p-1', userId: 'u-1' }]];
		await pledgeEntry({ userId: 'u-1', subjectType: 'item', subjectId: 'i-1', now: NOW });
		expect(inserted).toHaveLength(0);
	});
});

describe('releasePledge', () => {
	it("releases the caller's own open pledge", async () => {
		selectResults = [[{ id: 'p-1', userId: 'u-1', status: 'open' }]];
		await releasePledge({ userId: 'u-1', pledgeId: 'p-1', now: NOW });
		expect(updateCalls[0].values).toMatchObject({ status: 'released', closedAt: NOW });
	});

	it("will not release someone else's", async () => {
		selectResults = [[{ id: 'p-1', userId: 'u-2', status: 'open' }]];
		await expect(releasePledge({ userId: 'u-1', pledgeId: 'p-1', now: NOW })).rejects.toThrow(
			PledgeNotFoundError
		);
		expect(updateCalls).toHaveLength(0);
	});
});

describe('fulfilPledges', () => {
	it('does nothing when the arrival names neither a gear request nor a donor', async () => {
		await fulfilPledges({ itemIds: ['i-1'], now: NOW });
		expect(updateCalls).toHaveLength(0);
	});

	it('closes pledges as fulfilled when the arrival answers them', async () => {
		await fulfilPledges({ suggestionId: 's-1', itemIds: [], now: NOW });
		expect(updateCalls[0].values).toMatchObject({ status: 'fulfilled', closedAt: NOW });
	});
});
