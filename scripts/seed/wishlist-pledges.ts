import { and, eq, isNotNull } from 'drizzle-orm';
import { inventoryItem, wishlistPledge } from '../../src/lib/server/db/schema/inventory';
import { suggestion } from '../../src/lib/server/db/schema/suggestion';
import { batchInsert, db } from './db';

const DAY = 86_400_000;

/**
 * Wishlist pledges (#1492), every state: an open pledge on planned gear and on
 * a low supply (so `/contribute` shows "someone is bringing this" and intake
 * lists them), plus one expired, one released and one fulfilled that must not.
 */
export async function seedWishlistPledges(users: readonly { id: string }[]) {
	const gear = await db
		.select({ id: suggestion.id })
		.from(suggestion)
		.where(and(eq(suggestion.category, 'gear_equipment'), eq(suggestion.status, 'planned')))
		.limit(2);
	const supplies = await db
		.select({ id: inventoryItem.id })
		.from(inventoryItem)
		.where(isNotNull(inventoryItem.reorderPoint))
		.limit(2);
	if (gear.length === 0 || supplies.length === 0 || users.length < 3) return { pledges: 0 };

	const now = Date.now();
	const open = { status: 'open' as const, expiresAt: new Date(now + 20 * DAY) };
	const rows = await batchInsert(wishlistPledge, [
		{ userId: users[0].id, subjectType: 'suggestion', subjectId: gear[0].id, ...open },
		{ userId: users[1].id, subjectType: 'item', subjectId: supplies[0].id, ...open },
		{
			userId: users[2].id,
			subjectType: 'item',
			subjectId: supplies[1]?.id ?? supplies[0].id,
			status: 'open',
			expiresAt: new Date(now - 2 * DAY)
		},
		{
			userId: users[2].id,
			subjectType: 'suggestion',
			subjectId: gear[1]?.id ?? gear[0].id,
			status: 'released',
			expiresAt: new Date(now + 10 * DAY),
			closedAt: new Date(now - DAY)
		},
		{
			userId: users[1].id,
			subjectType: 'suggestion',
			subjectId: gear[0].id,
			status: 'fulfilled',
			expiresAt: new Date(now - 30 * DAY),
			closedAt: new Date(now - 40 * DAY)
		}
	]);
	return { pledges: rows.length };
}
