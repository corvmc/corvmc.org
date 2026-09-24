import { and, eq, lt } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { incident, incidentNote } from '$lib/server/db/schema/incident';
import { recordAuditEntry } from '$lib/server/audit/audit-service';
import { IncidentNotFoundError, type Actor } from './incident-service';

/**
 * Retention (#1468): an incident is deleted seven years after it happened
 * unless staff marked it `retain`. Notes go with it by FK cascade. Each
 * deletion is written to the audit log, which is then the only trace of it.
 */
export const INCIDENT_RETENTION_YEARS = 7;

const SYSTEM = { id: null, name: 'System', email: '' };

export function retentionCutoff(now: Date): Date {
	const cutoff = new Date(now);
	cutoff.setUTCFullYear(cutoff.getUTCFullYear() - INCIDENT_RETENTION_YEARS);
	return cutoff;
}

export async function sweepExpiredIncidents(now = new Date()): Promise<{ deleted: number }> {
	const deleted = await db
		.delete(incident)
		.where(and(eq(incident.retain, false), lt(incident.occurredAt, retentionCutoff(now))))
		.returning({
			id: incident.id,
			summary: incident.summary,
			category: incident.category,
			occurredAt: incident.occurredAt
		});

	for (const row of deleted) {
		await recordAuditEntry({
			action: 'incident.deleted',
			subject: { type: 'incident', id: row.id, label: row.summary },
			details: {
				category: row.category,
				occurredAt: row.occurredAt.toISOString(),
				retentionYears: INCIDENT_RETENTION_YEARS
			},
			actor: SYSTEM
		});
	}
	return { deleted: deleted.length };
}

/** Mark or release the retention hold. The reason goes on the record as a note. */
export async function setIncidentRetain(id: string, retain: boolean, reason: string, staff: Actor) {
	const [row] = await db
		.update(incident)
		.set({ retain, updatedAt: new Date() })
		.where(eq(incident.id, id))
		.returning();
	if (!row) throw new IncidentNotFoundError();

	const verb = retain ? 'Marked retain' : 'Retention hold released';
	await db.insert(incidentNote).values({
		incidentId: id,
		authorUserId: staff.id,
		authorName: staff.name,
		body: `${verb}: ${reason.trim()}`
	});
	return row;
}
