import {
	and,
	count,
	desc,
	eq,
	gte,
	inArray,
	lte,
	or,
	sql,
	type SQL,
	type SQLWrapper
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { getRequestEvent } from '$app/server';
import { db } from '#lib/server/db/index.js';
import { auditLog } from '#lib/server/db/schema/audit.js';
import { user } from '#lib/server/db/schema/authentication.js';
import { group } from '#lib/server/db/schema/group.js';
import { containsLiteral } from '#lib/server/db/like.js';
import { paginate, type PaginationInput, type PaginatedResult } from '#lib/server/db/paginate.js';
import {
	bandRefColumns,
	memberRefColumns,
	toBandRef,
	toMemberRef
} from '#lib/server/entity/refs.js';
import { buildDateInTz } from '#lib/server/reservation/timezone.js';
import { captureException } from '#lib/server/sentry.js';
import { DEFAULT_TIMEZONE } from '#lib/config.js';
import type { EntityRef, MemberRef } from '#lib/types/entity.js';
import { feedLimit } from '#lib/types/activity.js';
import type {
	AuditAction,
	AuditActor,
	AuditEntry,
	AuditEntryInput,
	AuditSubjectType
} from '#lib/types/audit.js';

export type { AuditActor, AuditEntryInput } from '#lib/types/audit.js';

const MAX_DETAILS_BYTES = 4096;
const MAX_LABEL_LENGTH = 200;

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

/** `created_at` is whole seconds and `id` random; rowid breaks a tie in the order rows were written. */
const writeOrder = sql`${auditLog}.rowid`;

/** One subject, or every subject of a type whose id a subquery yields (no bound parameter per id). */
export type AuditSubjectFilter =
	{ type: AuditSubjectType; id: string } | { type: AuditSubjectType; ids: SQLWrapper };

function subjectWhere(subjects: AuditSubjectFilter[]): SQL {
	const each = subjects.map((s) =>
		and(
			eq(auditLog.subjectType, s.type),
			'id' in s ? eq(auditLog.subjectId, s.id) : inArray(auditLog.subjectId, s.ids)
		)
	);
	return (each.length === 1 ? each[0] : or(...each))!;
}

/** The read behind every history feed. Exported so a spec can read its SQL and bound parameters. */
export function auditSubjectQuery(subjects: AuditSubjectFilter[], limit: number) {
	return db
		.select()
		.from(auditLog)
		.where(subjectWhere(subjects))
		.orderBy(desc(auditLog.createdAt), desc(writeOrder))
		.limit(limit);
}

/**
 * One page of a subject's entries, newest first. Read with `limit + 1`, so
 * `hasMore` is exact; "show older" asks again with a longer `limit`.
 */
export async function listAuditEntriesForSubject(
	subjects: AuditSubjectFilter | AuditSubjectFilter[],
	opts: { limit?: number } = {}
): Promise<{ entries: AuditEntry[]; hasMore: boolean }> {
	const limit = feedLimit(opts.limit);
	const list = Array.isArray(subjects) ? subjects : [subjects];
	const rows = (await auditSubjectQuery(list, limit + 1)) as AuditEntry[];
	return { entries: rows.slice(0, limit), hasMore: rows.length > limit };
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
		.orderBy(desc(auditLog.createdAt), desc(writeOrder))
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
						: entry.subjectType === 'incident'
							? // A deleted record: its stored label, unlinked.
								({ type: 'incident', id: null, title: stored.name } as const)
							: entry.subjectType === 'production'
								? // A production has no page of its own; its event's console is where it lives.
									({
										type: 'event',
										id: (entry.details as { eventId?: string | null }).eventId ?? null,
										title: stored.name
									} as const)
								: entry.subjectType === 'event'
									? ({ type: 'event', id: entry.subjectId, title: stored.name } as const)
									: entry.subjectType === 'role'
										? ({ type: 'role', id: entry.subjectId, title: stored.name } as const)
										: entry.subjectType === 'project'
											? ({ type: 'project', id: entry.subjectId, title: stored.name } as const)
											: entry.subjectType === 'work_order'
												? ({ type: 'shift', id: entry.subjectId, title: stored.name } as const)
												: entry.subjectType === 'group'
													? // A club or committee has no band page, so it renders unlinked.
														toBandRef(stored)
													: toBandRef(subjectBand?.id ? subjectBand : stored),
				actor: toMemberRef(actorUser?.id ? actorUser : { id: null, name: entry.actorName })
			};
		})
	};
}
