import { listPlannedGear } from '$lib/server/suggestion/suggestion-service';
import { listLowStock } from './stock-service';

/**
 * The public donation wishlist (#604): a projection of lists staff already
 * keep, never a list of its own. Public, so each entry is a name and nothing
 * else — no author, no counts, no ids.
 */
export async function getDonationWishlist() {
	const [gear, low] = await Promise.all([listPlannedGear(12), listLowStock()]);
	return {
		// `planned` only: `in_progress` means staff are already getting it.
		gear: gear.filter((g) => g.status === 'planned').map((g) => ({ title: g.title })),
		// Fully covered by an open order means we are not short, just waiting.
		supplies: low.filter((i) => i.suggestedOrder > 0).map((i) => ({ name: i.name, isOut: i.isOut }))
	};
}
