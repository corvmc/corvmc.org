import { and, eq } from 'drizzle-orm';
import {
	group,
	groupMember,
	groupPositionHolder,
	groupPosition
} from '../../src/lib/server/db/schema/group';
import {
	operationsGroupRow,
	operationsPositionId,
	operationsPositionRows
} from '../../src/lib/server/access/operations-rows';
import { OPERATIONS_GROUP_ID, type Job } from '../../src/lib/config';
import { batchInsert, db } from './db';
import { pendingEntries } from './pending';

/**
 * The Operations committee (#2992). The wipe empties the migration's copy, so
 * the seed writes the same rows back before anyone is given a job.
 */
export async function seedOperations(): Promise<void> {
	await batchInsert(group, [operationsGroupRow]);
	// The directory seeder writes every group's entry from this.
	pendingEntries.set(OPERATIONS_GROUP_ID, { visibility: 'members' });
	await batchInsert(groupPosition, operationsPositionRows());
}

/** Give a seeded person a job: an active Operations seat. */
export async function seatInOperations(userId: string, job: Job): Promise<void> {
	await db
		.insert(groupMember)
		.values({ groupId: OPERATIONS_GROUP_ID, userId, role: 'member', status: 'active' })
		.onConflictDoNothing();
	const [member] = await db
		.select({ id: groupMember.id })
		.from(groupMember)
		.where(and(eq(groupMember.groupId, OPERATIONS_GROUP_ID), eq(groupMember.userId, userId)));
	await db
		.insert(groupPositionHolder)
		.values({ positionId: operationsPositionId(job), memberId: member.id })
		.onConflictDoNothing();
}
