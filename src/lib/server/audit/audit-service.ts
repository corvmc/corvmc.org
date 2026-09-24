import { and, count, desc, eq, gte, lte, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { getRequestEvent } from '$app/server';
import { db } from '$lib/server/db';
import { auditLog } from '$lib/server/db/schema/audit';
import { user } from '$lib/server/db/schema/authentication';
import { group } from '$lib/server/db/schema/group';
import { containsLiteral } from '$lib/server/db/like';
import { paginate, type PaginationInput, type PaginatedResult } from '$lib/server/db/paginate';
import { bandRefColumns, memberRefColumns, toBandRef, toMemberRef } from '$lib/server/entity/refs';
import { buildDateInTz } from '$lib/server/reservation/timezone';
import { captureException } from '$lib/server/sentry';
import { DEFAULT_TIMEZONE } from '$lib/config';
import type { EntityRef, MemberRef } from '$lib/types/entity';
import type {
	AuditAction,
	AuditActor,
	AuditEntry,
	AuditEntryInput,
	AuditSubjectType
} from '$lib/types/audit';

export type { AuditActor, AuditEntryInput } from '$lib/types/audit';

const MAX_DETAILS_BYTES = 4096;
const MAX_LABEL_LENGTH = 200;
const DEFAULT_SUBJECT_LIMIT = 20;
const MAX_SUBJECT_LIMIT = 100;

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

export interface AuditLogFilters {
	action?: AuditAction;
	/** Matched against the actor's stored name and email, so a purged staffer is still findable. */
	actor?: string;
	/** `YYYY-MM-DD`, whole days in the collective's time zone, inclusive. */
	from?: string;
	to?: string;
}

export type AuditLogRow = AuditEntry & { subject: EntityRef; actor: MemberRef };

/** Every subject's entries, newest first. A purged subject or actor renders its stored label, unlinked. */
export async function listAuditEntries(
	filters: AuditLogFilters,
	pagination: PaginationInput = {}
): Promise<PaginatedResult<AuditLogRow>> {
	const conditions: SQL[] = [];
	if (filters.action) conditions.push(eq(auditLog.action, filters.action));
	const actor = filters.actor?.trim();
	if (actor) {
		conditions.push(
			or(containsLiteral(auditLog.actorName, actor), containsLiteral(auditLog.actorEmail, actor))!
		);
	}
	if (filters.from) {
		conditions.push(
			gte(auditLog.createdAt, buildDateInTz(filters.from, '00:00', DEFAULT_TIMEZONE))
		);
	}
	if (filters.to) {
		conditions.push(lte(auditLog.createdAt, buildDateInTz(filters.to, '23:59', DEFAULT_TIMEZONE)));
	}
	const where = conditions.length ? and(...conditions) : undefined;

	const subjectUser = alias(user, 'subject_user');
	const actorUser = alias(user, 'actor_user');
	const dataQ = db
		.select({
			entry: auditLog,
			subjectUser: memberRefColumns(subjectUser),
			subjectBand: bandRefColumns(group),
			actorUser: memberRefColumns(actorUser)
		})
		.from(auditLog)
		.leftJoin(
			subjectUser,
			and(eq(auditLog.subjectType, 'user'), eq(subjectUser.id, auditLog.subjectId))
		)
		// Raw SQL: a subject type is stored data, and `'band'` need not be in the enum yet.
		.leftJoin(group, and(sql`${auditLog.subjectType} = 'band'`, eq(group.id, auditLog.subjectId)))
		.leftJoin(actorUser, eq(actorUser.id, auditLog.actorUserId))
		.where(where)
		.orderBy(desc(auditLog.createdAt), desc(auditLog.id))
		.$dynamic();
	const countQ = db.select({ count: count() }).from(auditLog).where(where);

	const result = await paginate(dataQ, countQ, pagination);
	return {
		...result,
		rows: result.rows.map(({ entry, subjectUser, subjectBand, actorUser }) => {
			const stored = { id: null, name: entry.subjectLabel ?? entry.subjectId };
			return {
				...(entry as AuditEntry),
				subject:
					entry.subjectType === 'user'
						? toMemberRef(subjectUser?.id ? subjectUser : stored)
						: toBandRef(subjectBand?.id ? subjectBand : stored),
				actor: toMemberRef(actorUser?.id ? actorUser : { id: null, name: entry.actorName })
			};
		})
	};
}
