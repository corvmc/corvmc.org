import { listPlannedGear } from '$lib/server/suggestion/suggestion-service';
import { listLowStock } from './stock-service';
import { claimFor, listLivePledges } from './pledge-service';

/**
 * The public donation wishlist (#604): a projection of lists staff already
 * keep, never a list of its own. Public, so an entry is its name, the id a
 * pledge needs, and whether it is claimed — never who asked for it or who
 * pledged it. The viewer alone learns which pledge is theirs.
 */
export async function getDonationWishlist(viewerId?: string) {
	const [gear, low, pledges] = await Promise.all([
		listPlannedGear(12),
		listLowStock(),
		listLivePledges()
	]);
	const mine = (subjectType: 'suggestion' | 'item', id: string) => {
		const claim = claimFor(pledges, subjectType, id, viewerId);
		if (claim !== 'you') return { claim };
		const own = pledges.find((p) => p.subjectType === subjectType && p.subjectId === id);
		return { claim, pledgeId: own?.id };
	};
	return {
		// `planned` only: `in_progress` means staff are already getting it.
		gear: gear
			.filter((g) => g.status === 'planned')
			.map((g) => ({ id: g.id, title: g.title, ...mine('suggestion', g.id) })),
		// Fully covered by an open order means we are not short, just waiting.
		supplies: low
			.filter((i) => i.suggestedOrder > 0)
			.map((i) => ({ id: i.id, name: i.name, isOut: i.isOut, ...mine('item', i.id) }))
	};
}

/** Whether a pledge target is on the wishlist right now. */
export async function isOnWishlist(subjectType: 'suggestion' | 'item', id: string) {
	const { gear, supplies } = await getDonationWishlist();
	return (subjectType === 'suggestion' ? gear : supplies).some((e) => e.id === id);
}
