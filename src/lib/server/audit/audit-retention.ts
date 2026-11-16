import { and, eq, inArray, lt, ne, notInArray, or, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { auditLog } from '#lib/server/db/schema/audit.js';
import { incident } from '#lib/server/db/schema/incident.js';

/**
 * Retention (#1376): rows older than 24 months are deleted, except
 * `user.purged`, which is kept but loses the name and email it carried, and an
 * incident's own history, which lives exactly as long as the incident does.
 * This module is the only code allowed to delete from `audit_log`; a spec
 * beside it fails on any other.
 */
export const AUDIT_RETENTION_MONTHS = 24;

/** One DELETE's row count. The cap bounds a first run over a large backlog. */
export const AUDIT_DELETE_BATCH = 500;
const MAX_BATCHES_PER_RUN = 40;

/** Kept past 24 months while the incident exists: a seven-year record's reasons go with it. */
export const INCIDENT_LIFETIME_ACTIONS = [
	'incident.reopened',
	'incident.retention_changed'
] as const;

export function auditRetentionCutoff(now: Date): Date {
	const cutoff = new Date(now);
	cutoff.setUTCMonth(cutoff.getUTCMonth() - AUDIT_RETENTION_MONTHS);
	return cutoff;
}

export async function sweepAuditLog(
	now = new Date()
): Promise<{ deleted: number; redacted: number }> {
	const cutoff = auditRetentionCutoff(now);

	let deleted = 0;
	for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
		// D1 has no DELETE ... LIMIT, so the batch is an id subquery.
		const batch = await db
			.delete(auditLog)
			.where(
				sql`${auditLog.id} in (select ${auditLog.id} from ${auditLog} where ${and(
					ne(auditLog.action, 'user.purged'),
					notInArray(auditLog.action, [...INCIDENT_LIFETIME_ACTIONS]),
					lt(auditLog.createdAt, cutoff)
				)} limit ${AUDIT_DELETE_BATCH})`
			)
			.returning({ id: auditLog.id });
		deleted += batch.length;
		if (batch.length < AUDIT_DELETE_BATCH) break;
	}

	// The incident sweep has deleted the record these describe.
	const orphaned = await db
		.delete(auditLog)
		.where(
			and(
				inArray(auditLog.action, [...INCIDENT_LIFETIME_ACTIONS]),
				notInArray(auditLog.subjectId, db.select({ id: incident.id }).from(incident))
			)
		)
		.returning({ id: auditLog.id });
	deleted += orphaned.length;

	const redacted = await db
		.update(auditLog)
		.set({
			details: sql`json_remove(${auditLog.details}, '$.name', '$.email')`,
			subjectLabel: null
		})
		.where(
			and(
				eq(auditLog.action, 'user.purged'),
				lt(auditLog.createdAt, cutoff),
				or(
					sql`json_type(${auditLog.details}, '$.name') is not null`,
					sql`json_type(${auditLog.details}, '$.email') is not null`
				)
			)
		)
		.returning({ id: auditLog.id });

	return { deleted, redacted: redacted.length };
}
