import { and, eq, inArray } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import {
	group,
	groupMember,
	groupPosition,
	groupPositionHolder
} from '#lib/server/db/schema/group.js';
import { directoryEntry } from '#lib/server/db/schema/directory.js';
import { OPERATIONS_GROUP_ID, type Job } from '#lib/config.js';
import { operationsEntryRow, operationsGroupRow, operationsPositionRows } from './operations-rows';

/**
 * Holding a job is a seat in Operations (#2992). This file is the one runtime
 * writer of those seats; the Access page reaches it through `setPosition`.
 */

/** The Operations rows, made if a wiped or older database has none. */
export async function ensureOperations(): Promise<void> {
	await db.batch([
		db.insert(group).values(operationsGroupRow).onConflictDoNothing(),
		db.insert(directoryEntry).values(operationsEntryRow).onConflictDoNothing(),
		db.insert(groupPosition).values(operationsPositionRows()).onConflictDoNothing()
	]);
}

async function jobPositionId(job: Job): Promise<string> {
	const [row] = await db
		.select({ id: groupPosition.id })
		.from(groupPosition)
		.where(and(eq(groupPosition.groupId, OPERATIONS_GROUP_ID), eq(groupPosition.job, job)));
	if (!row) throw new Error(`Operations has no position for ${job}`);
	return row.id;
}

/** Give a person a job: an active Operations membership holding its position. */
export async function seatJob(userId: string, job: Job, assignedById: string | null) {
	await ensureOperations();
	const positionId = await jobPositionId(job);
	await db
		.insert(groupMember)
		.values({ groupId: OPERATIONS_GROUP_ID, userId, role: 'member', status: 'active' })
		.onConflictDoUpdate({
			target: [groupMember.groupId, groupMember.userId],
			set: { status: 'active', updatedAt: new Date() }
		});
	const [member] = await db
		.select({ id: groupMember.id })
		.from(groupMember)
		.where(and(eq(groupMember.groupId, OPERATIONS_GROUP_ID), eq(groupMember.userId, userId)));
	await db
		.insert(groupPositionHolder)
		.values({ positionId, memberId: member.id, assignedById })
		.onConflictDoNothing();
}

/** Take a job away. The membership stays: other seats may hang off it. */
export async function unseatJob(userId: string, job: Job) {
	const positionIds = db
		.select({ id: groupPosition.id })
		.from(groupPosition)
		.where(and(eq(groupPosition.groupId, OPERATIONS_GROUP_ID), eq(groupPosition.job, job)));
	const memberIds = db
		.select({ id: groupMember.id })
		.from(groupMember)
		.where(and(eq(groupMember.groupId, OPERATIONS_GROUP_ID), eq(groupMember.userId, userId)));
	await db
		.delete(groupPositionHolder)
		.where(
			and(
				inArray(groupPositionHolder.positionId, positionIds),
				inArray(groupPositionHolder.memberId, memberIds)
			)
		);
}
