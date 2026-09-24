import { and, asc, eq, gt, inArray, or } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { inventoryItem, suggestion, user, wishlistPledge } from '$lib/server/db/schema';
import { DomainError } from '$lib/server/domain-error';
import type { WishlistPledgeSubject } from '$lib/config';

/** How long a pledge holds an entry before it lets go on its own. */
export const PLEDGE_DAYS = 30;

export class PledgeTakenError extends DomainError {
	readonly httpStatus = 409;
	constructor() {
		super('Someone has already said they will bring this one.');
	}
}

export class PledgeNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('That pledge is not yours, or it has already closed.');
	}
}

export type Claim = 'none' | 'someone' | 'you';
type LivePledge = {
	id?: string;
	subjectType: WishlistPledgeSubject;
	subjectId: string;
	userId: string;
};

/** Who holds an entry, as the viewer may see it: never another donor's name. */
export function claimFor(
	pledges: readonly LivePledge[],
	subjectType: WishlistPledgeSubject,
	subjectId: string,
	viewerId: string | undefined
): Claim {
	const held = pledges.find((p) => p.subjectType === subjectType && p.subjectId === subjectId);
	if (!held) return 'none';
	return viewerId && held.userId === viewerId ? 'you' : 'someone';
}

const live = (now: Date) =>
	and(eq(wishlistPledge.status, 'open'), gt(wishlistPledge.expiresAt, now));

export async function listLivePledges(now = new Date()): Promise<LivePledge[]> {
	return db
		.select({
			id: wishlistPledge.id,
			subjectType: wishlistPledge.subjectType,
			subjectId: wishlistPledge.subjectId,
			userId: wishlistPledge.userId
		})
		.from(wishlistPledge)
		.where(live(now));
}

export async function pledgeEntry(input: {
	userId: string;
	subjectType: WishlistPledgeSubject;
	subjectId: string;
	now?: Date;
}) {
	const now = input.now ?? new Date();
	const [held] = await db
		.select({ id: wishlistPledge.id, userId: wishlistPledge.userId })
		.from(wishlistPledge)
		.where(
			and(
				live(now),
				eq(wishlistPledge.subjectType, input.subjectType),
				eq(wishlistPledge.subjectId, input.subjectId)
			)
		)
		.limit(1);
	if (held) {
		if (held.userId === input.userId) return;
		throw new PledgeTakenError();
	}

	await db.insert(wishlistPledge).values({
		userId: input.userId,
		subjectType: input.subjectType,
		subjectId: input.subjectId,
		status: 'open',
		expiresAt: new Date(now.getTime() + PLEDGE_DAYS * 86_400_000)
	});
}

export async function releasePledge(input: { userId: string; pledgeId: string; now?: Date }) {
	const [row] = await db
		.select({ id: wishlistPledge.id, userId: wishlistPledge.userId, status: wishlistPledge.status })
		.from(wishlistPledge)
		.where(eq(wishlistPledge.id, input.pledgeId))
		.limit(1);
	if (!row || row.userId !== input.userId || row.status !== 'open') {
		throw new PledgeNotFoundError();
	}

	await db
		.update(wishlistPledge)
		.set({ status: 'released', closedAt: input.now ?? new Date() })
		.where(eq(wishlistPledge.id, input.pledgeId));
}

/**
 * Closes what an arrival answers. A gear request's pledges close with it; a
 * supply pledge closes only when that donor's own donation brings the item,
 * since a staff purchase of strings says nothing about the member's.
 */
export async function fulfilPledges(input: {
	suggestionId?: string;
	itemIds: readonly string[];
	donorUserId?: string;
	now?: Date;
}) {
	const answers = [
		input.suggestionId
			? and(
					eq(wishlistPledge.subjectType, 'suggestion'),
					eq(wishlistPledge.subjectId, input.suggestionId)
				)
			: undefined,
		input.donorUserId && input.itemIds.length > 0
			? and(
					eq(wishlistPledge.subjectType, 'item'),
					inArray(wishlistPledge.subjectId, [...input.itemIds]),
					eq(wishlistPledge.userId, input.donorUserId)
				)
			: undefined
	].filter((c) => c !== undefined);
	if (answers.length === 0) return;

	await db
		.update(wishlistPledge)
		.set({ status: 'fulfilled', closedAt: input.now ?? new Date() })
		.where(and(eq(wishlistPledge.status, 'open'), or(...answers)));
}

/** Open pledges for staff at intake: what, who, and until when. */
export async function listOpenPledgesForStaff(now = new Date()) {
	const rows = await db
		.select({
			id: wishlistPledge.id,
			subjectType: wishlistPledge.subjectType,
			subjectId: wishlistPledge.subjectId,
			expiresAt: wishlistPledge.expiresAt,
			donorId: user.id,
			donorName: user.name,
			donorEmail: user.email,
			gearTitle: suggestion.title,
			itemName: inventoryItem.name
		})
		.from(wishlistPledge)
		.innerJoin(user, eq(user.id, wishlistPledge.userId))
		.leftJoin(
			suggestion,
			and(eq(wishlistPledge.subjectType, 'suggestion'), eq(suggestion.id, wishlistPledge.subjectId))
		)
		.leftJoin(
			inventoryItem,
			and(eq(wishlistPledge.subjectType, 'item'), eq(inventoryItem.id, wishlistPledge.subjectId))
		)
		.where(live(now))
		.orderBy(asc(wishlistPledge.expiresAt));

	return rows.map(({ gearTitle, itemName, ...r }) => ({
		...r,
		entryName: gearTitle ?? itemName ?? 'An item no longer on the wishlist'
	}));
}
