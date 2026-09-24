import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The public wishlist is a projection of two lists staff already keep, and it
 * is public — so what it must never carry matters as much as what it shows.
 */

vi.mock('$lib/server/suggestion/suggestion-service', () => ({
	listPlannedGear: vi.fn()
}));
vi.mock('./stock-service', () => ({
	listLowStock: vi.fn()
}));
vi.mock('./pledge-service', async (orig) => ({
	claimFor: (await orig<typeof import('./pledge-service')>()).claimFor,
	listLivePledges: vi.fn(async () => [])
}));

const { getDonationWishlist } = await import('./wishlist-service');
const { listPlannedGear } = await import('$lib/server/suggestion/suggestion-service');
const { listLowStock } = await import('./stock-service');
const { listLivePledges } = await import('./pledge-service');

beforeEach(() => {
	vi.mocked(listPlannedGear).mockResolvedValue([]);
	vi.mocked(listLowStock).mockResolvedValue([]);
});

describe('getDonationWishlist', () => {
	it('lists planned gear by title alone', async () => {
		vi.mocked(listPlannedGear).mockResolvedValue([
			{ id: 's-1', title: 'A bass amp for the jam room', status: 'planned', voteCount: 9 },
			{ id: 's-2', title: 'New drum throne', status: 'in_progress', voteCount: 4 }
		]);

		const { gear } = await getDonationWishlist();

		expect(gear).toEqual([{ id: 's-1', title: 'A bass amp for the jam room', claim: 'none' }]);
	});

	it('lists low supplies by name, leaving out what is already on order', async () => {
		vi.mocked(listLowStock).mockResolvedValue([
			{ id: 'i-1', name: 'Guitar strings (10s)', isOut: true, suggestedOrder: 10 },
			{ id: 'i-2', name: 'Gaff tape', isOut: false, suggestedOrder: 0 }
		] as never);

		const { supplies } = await getDonationWishlist();

		expect(supplies).toEqual([
			{ id: 'i-1', name: 'Guitar strings (10s)', isOut: true, claim: 'none' }
		]);
	});

	it('marks a pledged entry without saying who pledged it', async () => {
		vi.mocked(listPlannedGear).mockResolvedValue([
			{ id: 's-1', title: 'A bass amp', status: 'planned', voteCount: 1 }
		]);
		vi.mocked(listLivePledges).mockResolvedValue([
			{ subjectType: 'suggestion', subjectId: 's-1', userId: 'u-1' }
		] as never);

		expect((await getDonationWishlist('u-2')).gear[0]).toEqual({
			id: 's-1',
			title: 'A bass amp',
			claim: 'someone'
		});
		expect((await getDonationWishlist('u-1')).gear[0].claim).toBe('you');
	});
});
