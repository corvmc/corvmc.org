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
	reservationRefColumns,
	toBandRef,
	toMemberRef,
	toReservationRef,
	type ReservationRefRow
} from '#lib/server/entity/refs.js';
import { organization } from '#lib/server/db/schema/party.js';
import { incident } from '#lib/server/db/schema/incident.js';
import { reservation } from '#lib/server/db/schema/reservation.js';
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

/** A member as an entry's subject, labelled with their name so the row outlives a purge. */
export async function memberSubject(
	userId: string
): Promise<{ type: 'user'; id: string; label: string | null }> {
	const [row] = await db.select({ name: user.name }).from(user).where(eq(user.id, userId)).limit(1);
	return { type: 'user', id: userId, label: row?.name ?? null };
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
	/**
	 * Matched against the actor's stored name and email and the subject's stored
	 * label, so a purged staffer or a deleted record is still findable.
	 */
	search?: string;
	/** An event's show rows are its production's, so `event` takes both. */
	subjectType?: AuditSubjectType;
	/** `YYYY-MM-DD`, whole days in the collective's time zone, inclusive. */
	from?: string;
	to?: string;
}

/** `related` is a second record the row is about, such as the booking a staff cancellation took. */
export type AuditLogRow = AuditEntry & {
	subject: EntityRef;
	actor: MemberRef;
	related: EntityRef | null;
};

type SubjectRow = {
	entry: typeof auditLog.$inferSelect;
	subjectUser: Parameters<typeof toMemberRef>[0];
	subjectBand: Parameters<typeof toBandRef>[0];
	subjectOrganization: string | null;
	subjectContact: string | null;
	subjectIncident: string | null;
};

/**
 * What an entry's subject chip shows and links to. A subject whose row is gone
 * keeps its stored label, unlinked.
 */
function subjectRef(row: SubjectRow): EntityRef {
	const { entry } = row;
	const title = entry.subjectLabel ?? entry.subjectId;
	const stored = { id: null, name: title };
	switch (entry.subjectType) {
		case 'user':
			return toMemberRef(row.subjectUser?.id ? row.subjectUser : stored);
		case 'band':
			return toBandRef(row.subjectBand?.id ? row.subjectBand : stored);
		// A club or committee has no band page, so it renders unlinked.
		case 'group':
			return toBandRef(stored);
		case 'incident':
			return { type: 'incident', id: row.subjectIncident, title };
		case 'organization':
			return { type: 'organization', id: row.subjectOrganization, title };
		case 'contact':
			return { type: 'contact', id: row.subjectContact, title };
		// A production has no page of its own; its event's console is where it lives.
		case 'production':
			return {
				type: 'event',
				id: (entry.details as { eventId?: string | null }).eventId ?? null,
				title
			};
		case 'event':
			return { type: 'event', id: entry.subjectId, title };
		case 'role':
			return { type: 'role', id: entry.subjectId, title };
		case 'project':
			return { type: 'project', id: entry.subjectId, title };
		case 'work_order':
			return { type: 'shift', id: entry.subjectId, title };
		case 'inventory_asset':
			return { type: 'asset', id: entry.subjectId, title };
		// The label is the address; the entry's id is not a member's.
		case 'email_blocklist':
			return toMemberRef(stored);
		// No staff page of its own: the stored label, unlinked.
		case 'purchase_order':
			return { type: 'equipment', id: null, title };
		// The id is the key prefix (`reservation`, `feature`); settings span several pages.
		case 'setting': {
			const area = entry.subjectLabel ?? entry.subjectId;
			return {
				type: 'setting',
				id: null,
				title: `${area[0].toUpperCase()}${area.slice(1)} settings`
			};
		}
		default: {
			// A new subject type fails the type check here until it is mapped.
			const unmapped: never = entry.subjectType;
			return { type: 'equipment', id: null, title: String(unmapped) };
		}
	}
}

/** The booking a reservation row names in its details, linked while it exists. */
function relatedRef(
	entry: SubjectRow['entry'],
	booking: ReservationRefRow | null
): EntityRef | null {
	const id = (entry.details as { reservationId?: unknown }).reservationId;
	if (typeof id !== 'string' || !entry.action.startsWith('reservation.')) return null;
	return booking?.id ? toReservationRef(booking) : null;
}

/** Every subject's entries, newest first. A purged subject or actor renders its stored label, unlinked. */
export async function listAuditEntries(
	filters: AuditLogFilters,
	pagination: PaginationInput = {}
): Promise<PaginatedResult<AuditLogRow>> {
	const conditions: SQL[] = [];
	if (filters.action) conditions.push(eq(auditLog.action, filters.action));
	if (filters.subjectType) {
		conditions.push(
			filters.subjectType === 'event'
				? inArray(auditLog.subjectType, ['event', 'production'])
				: eq(auditLog.subjectType, filters.subjectType)
		);
	}
	const search = filters.search?.trim();
	if (search) {
		conditions.push(
			or(
				containsLiteral(auditLog.actorName, search),
				containsLiteral(auditLog.actorEmail, search),
				containsLiteral(auditLog.subjectLabel, search)
			)!
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
	// Raw SQL on the type: a subject type is stored data and need not be in the enum yet.
	const of = (type: string, id: Parameters<typeof eq>[0]) =>
		and(sql`${auditLog.subjectType} = ${type}`, eq(id, auditLog.subjectId));
	// The contact table is its service's alone (custom/no-contact-schema-imports), so a
	// contact's own deletion row is what says it is gone.
	const liveContactId = sql<string | null>`case when ${auditLog.subjectType} = 'contact'
		and not exists (select 1 from audit_log gone where gone.subject_type = 'contact'
			and gone.subject_id = ${auditLog.subjectId} and gone.action = 'contact.deleted')
		then ${auditLog.subjectId} end`;
	const bookingId = sql`json_extract(${auditLog.details}, '$.reservationId')`;
	const dataQ = db
		.select({
			entry: auditLog,
			subjectUser: memberRefColumns(subjectUser),
			subjectBand: bandRefColumns(group),
			subjectOrganization: organization.id,
			subjectContact: liveContactId,
			subjectIncident: incident.id,
			booking: reservationRefColumns(reservation),
			actorUser: memberRefColumns(actorUser)
		})
		.from(auditLog)
		.leftJoin(subjectUser, of('user', subjectUser.id))
		.leftJoin(group, of('band', group.id))
		.leftJoin(organization, of('organization', organization.id))
		.leftJoin(incident, of('incident', incident.id))
		.leftJoin(reservation, eq(reservation.id, bookingId))
		.leftJoin(actorUser, eq(actorUser.id, auditLog.actorUserId))
		.where(where)
		.orderBy(desc(auditLog.createdAt), desc(writeOrder))
		.$dynamic();
	const countQ = db.select({ count: count() }).from(auditLog).where(where);

	const result = await paginate(dataQ, countQ, pagination);
	return {
		...result,
		rows: result.rows.map((row) => ({
			...(row.entry as AuditEntry),
			subject: subjectRef(row),
			related: relatedRef(row.entry, row.booking?.id ? (row.booking as ReservationRefRow) : null),
			actor: toMemberRef(
				row.actorUser?.id ? row.actorUser : { id: null, name: row.entry.actorName }
			)
		}))
	};
}
