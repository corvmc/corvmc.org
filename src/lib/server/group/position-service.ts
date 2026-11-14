import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { db } from '#lib/server/db/index.js';
import {
	group,
	groupMember,
	groupPosition,
	groupPositionHolder
} from '#lib/server/db/schema/group.js';
import { user } from '#lib/server/db/schema/authentication.js';
import { DomainError } from '#lib/server/domain-error.js';
import { isUniqueConstraintError } from '#lib/server/db/constraint-errors.js';
import { memberRefColumns, toMemberRef } from '#lib/server/entity/refs.js';

/** The longest position name: a short title, not a description. */
export const POSITION_NAME_MAX = 60;

export class PositionError extends DomainError {
	constructor(
		message: string,
		readonly httpStatus: 400 | 404 | 409
	) {
		super(message);
	}
}

function cleanName(name: string): string {
	const trimmed = name.trim().replace(/\s+/g, ' ');
	if (!trimmed) throw new PositionError('A position needs a name.', 400);
	if (trimmed.length > POSITION_NAME_MAX) {
		throw new PositionError(`Keep a position name to ${POSITION_NAME_MAX} characters.`, 400);
	}
	return trimmed;
}

async function requireCommittee(groupId: string) {
	const [g] = await db
		.select({ kind: group.kind })
		.from(group)
		.where(and(eq(group.id, groupId), isNull(group.deletedAt)));
	if (!g) throw new PositionError('Group not found.', 404);
	if (g.kind !== 'committee') throw new PositionError('Only a committee has positions.', 400);
}

/**
 * A position the committee may edit. One that carries a job grants staff
 * capabilities (#2992), so it is set only where `user.setRole` is checked.
 */
async function requirePosition(groupId: string, positionId: string) {
	const [p] = await db
		.select({
			id: groupPosition.id,
			name: groupPosition.name,
			isChair: groupPosition.isChair,
			job: groupPosition.job
		})
		.from(groupPosition)
		.where(and(eq(groupPosition.id, positionId), eq(groupPosition.groupId, groupId)));
	if (!p) throw new PositionError('Position not found.', 404);
	if (p.job) throw new PositionError('Staff positions are set on the Access page.', 400);
	return p;
}

function duplicate(err: unknown, name: string): never {
	if (isUniqueConstraintError(err)) {
		throw new PositionError(`This committee already has a position called ${name}.`, 409);
	}
	throw err;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** A committee's positions, the chair first then A to Z, each with its holders. */
export async function listPositions(groupId: string) {
	const [positions, holders] = await Promise.all([
		db
			.select({
				id: groupPosition.id,
				name: groupPosition.name,
				isChair: groupPosition.isChair,
				job: groupPosition.job
			})
			.from(groupPosition)
			.where(eq(groupPosition.groupId, groupId))
			.orderBy(desc(groupPosition.isChair), asc(groupPosition.name)),
		db
			.select({
				positionId: groupPositionHolder.positionId,
				memberId: groupPositionHolder.memberId,
				member: memberRefColumns()
			})
			.from(groupPositionHolder)
			.innerJoin(groupPosition, eq(groupPosition.id, groupPositionHolder.positionId))
			.innerJoin(groupMember, eq(groupMember.id, groupPositionHolder.memberId))
			.innerJoin(user, eq(user.id, groupMember.userId))
			.where(and(eq(groupPosition.groupId, groupId), isNull(user.deletedAt)))
			.orderBy(asc(user.name))
	]);
	return positions.map((p) => ({
		...p,
		holders: holders
			.filter((h) => h.positionId === p.id)
			.map((h) => ({ memberId: h.memberId, member: toMemberRef(h.member) }))
	}));
}

/** Every committee position one person holds, by committee then name. */
export async function listPositionsHeld(userId: string) {
	return db
		.select({
			positionId: groupPosition.id,
			name: groupPosition.name,
			isChair: groupPosition.isChair,
			groupId: group.id,
			groupName: group.name,
			groupSlug: group.slug
		})
		.from(groupPositionHolder)
		.innerJoin(groupPosition, eq(groupPosition.id, groupPositionHolder.positionId))
		.innerJoin(groupMember, eq(groupMember.id, groupPositionHolder.memberId))
		.innerJoin(group, eq(group.id, groupPosition.groupId))
		.where(
			and(eq(groupMember.userId, userId), eq(groupMember.status, 'active'), isNull(group.deletedAt))
		)
		.orderBy(asc(group.name), asc(groupPosition.name));
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export async function createPosition(groupId: string, name: string) {
	await requireCommittee(groupId);
	const clean = cleanName(name);
	try {
		const [row] = await db
			.insert(groupPosition)
			.values({ groupId, name: clean })
			.returning({ id: groupPosition.id });
		return row;
	} catch (err) {
		duplicate(err, clean);
	}
}

export async function renamePosition(groupId: string, positionId: string, name: string) {
	await requirePosition(groupId, positionId);
	const clean = cleanName(name);
	try {
		await db
			.update(groupPosition)
			.set({ name: clean, updatedAt: new Date() })
			.where(eq(groupPosition.id, positionId));
	} catch (err) {
		duplicate(err, clean);
	}
}

/** Its holders go with it. The chair position stays: a committee always has one. */
export async function deletePosition(groupId: string, positionId: string) {
	const p = await requirePosition(groupId, positionId);
	if (p.isChair) throw new PositionError('The chair position cannot be removed.', 400);
	await db.delete(groupPosition).where(eq(groupPosition.id, positionId));
}

/**
 * Replace who holds a position. Each holder must be an active member of the
 * position's own committee; the ids come from the client.
 */
export async function setHolders(
	groupId: string,
	positionId: string,
	memberIds: string[],
	assignedById: string
) {
	await requirePosition(groupId, positionId);
	const wanted = [...new Set(memberIds)];
	if (wanted.length > 0) {
		const found = await db
			.select({ id: groupMember.id })
			.from(groupMember)
			.where(
				and(
					inArray(groupMember.id, wanted),
					eq(groupMember.groupId, groupId),
					eq(groupMember.status, 'active')
				)
			);
		if (found.length !== wanted.length) {
			throw new PositionError('A holder must be an active member of this committee.', 400);
		}
	}

	const current = await db
		.select({ memberId: groupPositionHolder.memberId })
		.from(groupPositionHolder)
		.where(eq(groupPositionHolder.positionId, positionId));
	const had = new Set(current.map((c) => c.memberId));
	const keep = new Set(wanted);
	const removed = [...had].filter((id) => !keep.has(id));
	const added = wanted.filter((id) => !had.has(id));

	const writes: BatchItem<'sqlite'>[] = [];
	if (removed.length > 0) {
		writes.push(
			db
				.delete(groupPositionHolder)
				.where(
					and(
						eq(groupPositionHolder.positionId, positionId),
						inArray(groupPositionHolder.memberId, removed)
					)
				)
		);
	}
	if (added.length > 0) {
		writes.push(
			db
				.insert(groupPositionHolder)
				.values(added.map((memberId) => ({ positionId, memberId, assignedById })))
				.onConflictDoNothing()
		);
	}
	if (writes.length > 0) await db.batch(writes as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);
	return { added, removed };
}
