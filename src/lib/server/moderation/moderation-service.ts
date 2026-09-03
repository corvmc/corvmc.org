import { db } from '$lib/server/db';
import { userBlock, type UserBlockSource } from '$lib/server/db/schema/moderation';
import { user } from '$lib/server/db/schema/authentication';
import { getStanding } from '$lib/server/moderation/standing-service';
import { eq, and, or, desc, sql } from 'drizzle-orm';
import type { SQL, SQLWrapper } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

/**
 * A SQL fragment: "these two have a block between them, either way round."
 *
 * Exported as a fragment rather than a boolean helper so it can go straight
 * into a WHERE clause. A caller that fetches a row and then checks a boolean
 * has a race and a second code path; a caller whose query simply cannot return
 * the row has neither.
 *
 * Either side may be a **column** rather than an id: `sql` binds a string as a
 * parameter and renders a column reference as an identifier, so the same body
 * serves "are these two blocked" and "is this row's member blocked from me".
 * The directory match query needs the second, and one definition of what a
 * block means is the point — a second hand-written EXISTS is how the two
 * drift.
 */
export function blockExistsBetween(
	aUserId: string | SQLWrapper,
	bUserId: string | SQLWrapper
): SQL {
	return sql`EXISTS (SELECT 1 FROM user_block ub
	                   WHERE (ub.blocker_user_id = ${aUserId} AND ub.blocked_user_id = ${bUserId})
	                      OR (ub.blocker_user_id = ${bUserId} AND ub.blocked_user_id = ${aUserId}))`;
}

/** The same question as an await, for the paths that are deciding whether to create something. */
export async function isBlockedEitherWay(aUserId: string, bUserId: string): Promise<boolean> {
	const [row] = await db
		.select({ id: userBlock.id })
		.from(userBlock)
		.where(
			or(
				and(eq(userBlock.blockerUserId, aUserId), eq(userBlock.blockedUserId, bUserId)),
				and(eq(userBlock.blockerUserId, bUserId), eq(userBlock.blockedUserId, aUserId))
			)
		)
		.limit(1);
	return Boolean(row);
}

export interface BlockUserParams {
	blockerUserId: string;
	blockedUserId: string;
	source?: UserBlockSource;
}

/**
 * Idempotent: blocking someone twice, or both people blocking each other, is
 * fine. Every check reads in both directions, so a second row changes nothing.
 */
export async function blockUser(params: BlockUserParams): Promise<void> {
	if (params.blockerUserId === params.blockedUserId) return;
	await db
		.insert(userBlock)
		.values({
			blockerUserId: params.blockerUserId,
			blockedUserId: params.blockedUserId,
			source: params.source ?? 'manual'
		})
		.onConflictDoNothing();
}

/**
 * Removes only this person's block. If the other party blocked too, their row
 * stands and the two still cannot reach each other — which is correct, and the
 * thing to remember before "simplifying" this to delete both directions.
 */
export async function unblockUser(blockerUserId: string, blockedUserId: string): Promise<void> {
	await db
		.delete(userBlock)
		.where(
			and(eq(userBlock.blockerUserId, blockerUserId), eq(userBlock.blockedUserId, blockedUserId))
		);
}

export interface BlockedMember {
	userId: string;
	name: string;
	source: UserBlockSource;
	createdAt: Date;
}

/** Who this member has blocked, for their own account page. */
export async function listBlockedBy(blockerUserId: string): Promise<BlockedMember[]> {
	const rows = await db
		.select({
			userId: userBlock.blockedUserId,
			name: user.name,
			source: userBlock.source,
			createdAt: userBlock.createdAt
		})
		.from(userBlock)
		.innerJoin(user, eq(user.id, userBlock.blockedUserId))
		.where(eq(userBlock.blockerUserId, blockerUserId))
		.orderBy(desc(userBlock.createdAt));

	return rows.map((r) => ({
		userId: r.userId,
		name: r.name,
		source: r.source,
		createdAt: r.createdAt
	}));
}

// ---------------------------------------------------------------------------
// Messaging policy
// ---------------------------------------------------------------------------

// Two halves decide whether a member can be messaged, and they are deliberately
// different things:
//
//   - their `messaging` standing, which staff or an upheld report imposed, and
//   - `user.acceptsDirectMessages`, which is the member's own preference.
//
// Only the second is theirs to change. Keeping them apart is why neither needs
// to record who set it — see `docs/specs/shipped/member-standing-spec.md`.

/** May this member start new conversations? Restriction only; a preference doesn't stop them replying. */
export async function canInitiateMessages(userId: string): Promise<boolean> {
	const { status } = await getStanding(userId, 'messaging');
	return status === 'none';
}

/** The member's own switch, on its own. Defaults to reachable for a row that isn't there. */
export async function acceptsDirectMessages(userId: string): Promise<boolean> {
	const [row] = await db
		.select({ acceptsDirectMessages: user.acceptsDirectMessages })
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);
	return row?.acceptsDirectMessages ?? true;
}

/**
 * May anyone message this member at all, in either direction?
 *
 * True when staff switched messaging off *or* the member did. The caller cannot
 * tell which, and shouldn't: both answers are "not reachable", and telling a
 * sender which one it was would leak either a moderation decision or a personal
 * preference.
 */
export async function messagingIsDisabled(userId: string): Promise<boolean> {
	if (!(await acceptsDirectMessages(userId))) return true;
	const { status } = await getStanding(userId, 'messaging');
	return status === 'disabled';
}

/** The member's own switch. Never touches standing, so it cannot lift a restriction. */
export async function setAcceptsDirectMessages(userId: string, accepts: boolean): Promise<void> {
	await db.update(user).set({ acceptsDirectMessages: accepts }).where(eq(user.id, userId));
}

/** What the member sees on their own account page: their switch, plus any restriction on them. */
export async function getMessagingState(userId: string) {
	return {
		acceptsDirectMessages: await acceptsDirectMessages(userId),
		standing: await getStanding(userId, 'messaging')
	};
}
