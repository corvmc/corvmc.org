import { and, asc, eq, gt, inArray, or, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { inventoryItem, suggestion, user, wishlistPledge } from '$lib/server/db/schema';
import { DomainError } from '$lib/server/domain-error';
import { dispatchEmailOnly } from '$lib/server/notification/dispatcher';
import type { WishlistPledgeSubject } from '$lib/config';

/** How long a pledge holds an entry before it lets go on its own. */
export const PLEDGE_DAYS = 30;
/** How long a guest has to confirm by email before the pending row is dead. */
export const GUEST_CONFIRM_HOURS = 24;

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
	userId: string | null;
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
	const held = await heldBy(input.subjectType, input.subjectId, now);
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

async function heldBy(subjectType: WishlistPledgeSubject, subjectId: string, now: Date) {
	const [held] = await db
		.select({ id: wishlistPledge.id, userId: wishlistPledge.userId })
		.from(wishlistPledge)
		.where(
			and(
				live(now),
				eq(wishlistPledge.subjectType, subjectType),
				eq(wishlistPledge.subjectId, subjectId)
			)
		)
		.limit(1);
	return held ?? null;
}

async function entryName(subjectType: WishlistPledgeSubject, subjectId: string) {
	const [row] =
		subjectType === 'suggestion'
			? await db
					.select({ name: suggestion.title })
					.from(suggestion)
					.where(eq(suggestion.id, subjectId))
					.limit(1)
			: await db
					.select({ name: inventoryItem.name })
					.from(inventoryItem)
					.where(eq(inventoryItem.id, subjectId))
					.limit(1);
	return row?.name ?? 'an item on our wishlist';
}

export async function hashPledgeToken(token: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
	return Buffer.from(digest).toString('hex');
}

/**
 * A non-member's pledge (#1565). It holds nothing until the address confirms,
 * so a typo or a stranger's address cannot mark the list claimed.
 */
export async function startGuestPledge(input: {
	subjectType: WishlistPledgeSubject;
	subjectId: string;
	name: string;
	email: string;
	now?: Date;
}) {
	const now = input.now ?? new Date();
	if (await heldBy(input.subjectType, input.subjectId, now)) throw new PledgeTakenError();

	const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
	const email = input.email.trim().toLowerCase();
	const name = await entryName(input.subjectType, input.subjectId);
	await db.insert(wishlistPledge).values({
		userId: null,
		guestName: input.name.trim(),
		guestEmail: email,
		confirmTokenHash: await hashPledgeToken(token),
		subjectType: input.subjectType,
		subjectId: input.subjectId,
		status: 'pending',
		expiresAt: new Date(now.getTime() + GUEST_CONFIRM_HOURS * 3_600_000)
	});

	await dispatchEmailOnly({
		type: 'wishlist_pledge_confirm',
		toEmail: email,
		email: {
			recipientName: input.name.trim(),
			subject: `Confirm you'll bring ${name}`,
			preview_text: 'One click and the wishlist shows it as taken.',
			heading: 'Confirm your pledge',
			paragraphs: [
				{
					text: `You said you would bring ${name} to the Corvallis Music Collective. Confirm it and we will mark it as taken for ${PLEDGE_DAYS} days, so nobody else buys one too.`
				},
				{ text: `The link works once, for the next ${GUEST_CONFIRM_HOURS} hours.` }
			],
			cta: { label: 'Confirm my pledge', url: `/contribute/pledge/${token}` },
			footnote: 'If this was not you, ignore this email. Nothing is claimed unless you confirm.',
			transactional_only: true
		}
	});
}

async function findPending(token: string, now: Date) {
	const [row] = await db
		.select({
			id: wishlistPledge.id,
			subjectType: wishlistPledge.subjectType,
			subjectId: wishlistPledge.subjectId,
			expiresAt: wishlistPledge.expiresAt
		})
		.from(wishlistPledge)
		.where(
			and(
				eq(wishlistPledge.confirmTokenHash, await hashPledgeToken(token)),
				eq(wishlistPledge.status, 'pending')
			)
		)
		.limit(1);
	return row && row.expiresAt > now ? row : null;
}

/** What a confirmation link is for, read without changing anything. */
export async function getGuestPledge(token: string, now = new Date()) {
	const row = await findPending(token, now);
	return row ? { entryName: await entryName(row.subjectType, row.subjectId) } : null;
}

export type GuestConfirmResult = { status: 'confirmed' | 'taken' | 'invalid' };

export async function confirmGuestPledge(
	token: string,
	now = new Date()
): Promise<GuestConfirmResult> {
	const row = await findPending(token, now);
	if (!row) return { status: 'invalid' };
	if (await heldBy(row.subjectType, row.subjectId, now)) return { status: 'taken' };

	await db
		.update(wishlistPledge)
		.set({
			status: 'open',
			expiresAt: new Date(now.getTime() + PLEDGE_DAYS * 86_400_000),
			confirmTokenHash: null
		})
		.where(and(eq(wishlistPledge.id, row.id), eq(wishlistPledge.status, 'pending')));
	return { status: 'confirmed' };
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
			donorName: sql<string>`coalesce(${user.name}, ${wishlistPledge.guestName})`,
			donorEmail: sql<string>`coalesce(${user.email}, ${wishlistPledge.guestEmail})`,
			gearTitle: suggestion.title,
			itemName: inventoryItem.name
		})
		.from(wishlistPledge)
		.leftJoin(user, eq(user.id, wishlistPledge.userId))
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
