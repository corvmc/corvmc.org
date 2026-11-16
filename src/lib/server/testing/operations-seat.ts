import { OPERATIONS_GROUP_ID, type Job } from '#lib/config.js';
import { operationsPositionId } from '#lib/server/access/operations-rows.js';

/**
 * SQL that gives a user a job the way production holds one: an active seat in
 * Operations (#2992). For a spec over `migratedSqlite()`, whose migrations
 * already made the Operations group and its positions.
 */
export function seatSql(userId: string, job: Job): string {
	const memberId = `ops-${userId}`;
	return `INSERT OR IGNORE INTO group_member (id, group_id, user_id, role, status)
		VALUES ('${memberId}', '${OPERATIONS_GROUP_ID}', '${userId}', 'member', 'active');
	INSERT OR IGNORE INTO group_position_holder (position_id, member_id)
		SELECT '${operationsPositionId(job)}', id FROM group_member
		WHERE group_id = '${OPERATIONS_GROUP_ID}' AND user_id = '${userId}';`;
}
