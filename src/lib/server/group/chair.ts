import { and, eq, inArray, not, or, sql, type SQL } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import {
	group,
	groupMember,
	groupPosition,
	groupPositionHolder,
	type GroupRole
} from '#lib/server/db/schema/group.js';

/**
 * Who leads a group (#3009): a band's `owner`, a club's `admin`, a committee's
 * chair position. A committee row's stored role is always `member`, so every
 * committee chair check reads the position, through this file and nothing else.
 * `scripts/committee-chair-guard.spec.ts` fails on a stored-role leader test
 * anywhere outside it.
 */

/** The name a committee's chair position gets when one is made for it. */
export const CHAIR_POSITION_NAME = 'Chair';

/**
 * For a query over `group_member`: this row holds its committee's chair
 * position. Raw SQL rather than a `db` subquery, so a predicate module that
 * never touches `db` (system audiences) can carry it.
 */
export function holdsChair(): SQL {
	return sql`exists (select 1 from ${groupPositionHolder}
		inner join ${groupPosition} on ${groupPosition.id} = ${groupPositionHolder.positionId}
		where ${groupPositionHolder.memberId} = ${groupMember.id} and ${groupPosition.isChair} = 1)`;
}

/** This row belongs to a committee. */
const onCommittee = () =>
	sql`${groupMember.groupId} in (select ${group.id} from ${group} where ${group.kind} = 'committee')`;

/** The one committee chair check: an active member holding the chair position. */
export async function isCommitteeChair(userId: string, groupId: string): Promise<boolean> {
	const [row] = await db
		.select({ one: sql`1` })
		.from(groupMember)
		.innerJoin(group, eq(group.id, groupMember.groupId))
		.where(
			and(
				eq(groupMember.groupId, groupId),
				eq(groupMember.userId, userId),
				eq(groupMember.status, 'active'),
				eq(group.kind, 'committee'),
				holdsChair()
			)
		)
		.limit(1);
	return !!row;
}

/**
 * For a set query over `group_member` (recipients, "groups I run"): the row
 * leads its group. The caller still filters on `status`.
 */
export function leadsGroup(): SQL {
	return or(and(inArray(groupMember.role, ['owner', 'admin']), not(onCommittee())), holdsChair())!;
}

/**
 * The tier a roster row carries, for reads that hand a role to the UI: the
 * stored role for a band or club, and for a committee `admin` when the row
 * holds the chair. A guard's `admin` means the same thing.
 */
export function rosterRole(): SQL<GroupRole> {
	return sql<GroupRole>`case when ${onCommittee()}
		then case when ${holdsChair()} then 'admin' else 'member' end
		else ${groupMember.role} end`;
}

/** Leaders first, then everyone else: an `orderBy` term for a roster. */
export function leadersFirst(): SQL {
	return sql`case ${rosterRole()} when 'owner' then 0 when 'admin' then 1 else 2 end`;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

async function findChairPosition(groupId: string) {
	const [row] = await db
		.select({ id: groupPosition.id })
		.from(groupPosition)
		.where(and(eq(groupPosition.groupId, groupId), eq(groupPosition.isChair, true)))
		.limit(1);
	return row?.id ?? null;
}

/**
 * The committee's chair position, made if it has none. A position already
 * called Chair becomes it, since the name is unique within a committee.
 */
export async function ensureChairPosition(groupId: string): Promise<string> {
	const found = await findChairPosition(groupId);
	if (found) return found;
	await db
		.insert(groupPosition)
		.values({ groupId, name: CHAIR_POSITION_NAME, isChair: true })
		.onConflictDoNothing();
	const made = await findChairPosition(groupId);
	if (made) return made;
	await db
		.update(groupPosition)
		.set({ isChair: true, updatedAt: new Date() })
		.where(and(eq(groupPosition.groupId, groupId), eq(groupPosition.name, CHAIR_POSITION_NAME)));
	const named = await findChairPosition(groupId);
	if (!named) throw new Error(`No chair position for committee ${groupId}`);
	return named;
}

/** Fill or vacate the chair for one roster row of a committee. */
export async function setChairHolder(
	groupId: string,
	memberId: string,
	chair: boolean,
	assignedById: string | null
): Promise<void> {
	const positionId = await ensureChairPosition(groupId);
	if (chair) {
		await db
			.insert(groupPositionHolder)
			.values({ positionId, memberId, assignedById })
			.onConflictDoNothing();
	} else {
		await db
			.delete(groupPositionHolder)
			.where(
				and(
					eq(groupPositionHolder.positionId, positionId),
					eq(groupPositionHolder.memberId, memberId)
				)
			);
	}
}
