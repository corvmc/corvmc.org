import { and, desc, eq } from 'drizzle-orm';
import { getRequestEvent } from '$app/server';
import { db } from '$lib/server/db';
import { auditLog } from '$lib/server/db/schema/audit';
import { captureException } from '$lib/server/sentry';
import type {
	AuditAction,
	AuditDetailsByAction,
	AuditEntry,
	AuditSubjectType
} from '$lib/types/audit';

const MAX_DETAILS_BYTES = 4096;
const MAX_LABEL_LENGTH = 200;
const DEFAULT_SUBJECT_LIMIT = 20;
const MAX_SUBJECT_LIMIT = 100;

export interface AuditActor {
	id: string | null;
	name: string;
	email: string;
}

export type AuditEntryInput = {
	[A in AuditAction]: {
		action: A;
		subject: { type: AuditSubjectType; id: string; label?: string | null };
		details: AuditDetailsByAction[A];
		/** Defaults to the signed-in user, or "System" when there is none. */
		actor?: AuditActor;
	};
}[AuditAction];

const SYSTEM_ACTOR: AuditActor = { id: null, name: 'System', email: '' };

function currentActor(): AuditActor {
	try {
		const u = getRequestEvent().locals.user;
		if (u) return { id: u.id, name: u.name, email: u.email };
	} catch {
		// Outside a request: a cron job or a script.
	}
	return SYSTEM_ACTOR;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Append one entry. Never throws: the action it records has already happened,
 * and a failed audit write must not turn that into an error the staffer sees.
 * Failures go to Sentry.
 */
export async function recordAuditEntry(input: AuditEntryInput): Promise<void> {
	try {
		const details = JSON.stringify(input.details);
		if (new TextEncoder().encode(details).length > MAX_DETAILS_BYTES) {
			throw new Error(`Audit details for ${input.action} exceed ${MAX_DETAILS_BYTES} bytes`);
		}
		const actor = input.actor ?? currentActor();
		await db.insert(auditLog).values({
			action: input.action,
			actorUserId: actor.id,
			actorName: actor.name,
			actorEmail: actor.email,
			subjectType: input.subject.type,
			subjectId: input.subject.id,
			subjectLabel: input.subject.label?.slice(0, MAX_LABEL_LENGTH) ?? null,
			details: input.details as Record<string, unknown>
		});
	} catch (err) {
		captureException(err);
	}
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function listAuditEntriesForSubject(
	type: AuditSubjectType,
	id: string,
	opts: { limit?: number } = {}
): Promise<AuditEntry[]> {
	const limit = Math.min(Math.max(opts.limit ?? DEFAULT_SUBJECT_LIMIT, 1), MAX_SUBJECT_LIMIT);
	const rows = await db
		.select()
		.from(auditLog)
		.where(and(eq(auditLog.subjectType, type), eq(auditLog.subjectId, id)))
		.orderBy(desc(auditLog.createdAt), desc(auditLog.id))
		.limit(limit);
	return rows as AuditEntry[];
}
