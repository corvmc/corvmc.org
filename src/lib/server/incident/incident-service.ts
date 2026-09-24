import { db } from '$lib/server/db';
import { incident, incidentNote } from '$lib/server/db/schema/incident';
import { user } from '$lib/server/db/schema/authentication';
import { and, asc, count, desc, eq, or } from 'drizzle-orm';
import { containsLiteral } from '$lib/server/db/like';
import { paginate, type PaginationInput } from '$lib/server/db/paginate';
import { DomainError } from '$lib/server/domain-error';
import type { IncidentCategory, IncidentStatus } from '$lib/config';

/**
 * The incident & safety log. docs/specs/incident-log-spec.md
 *
 * Staff-only, and nothing here acts on a member: recording that a member was
 * involved changes nothing about their account. There is no edit and no delete
 * — later facts are notes, so the record reads the way it happened.
 */

export const INCIDENT_SUMMARY_MAX = 200;
export const INCIDENT_DESCRIPTION_MAX = 5000;
export const INCIDENT_NOTE_MAX = 2000;
export const INCIDENT_LOCATION_MAX = 200;

/** Clock skew allowance: "just now" typed on a phone a minute fast is not the future. */
const FUTURE_TOLERANCE_MS = 15 * 60_000;

export class IncidentNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('Incident not found');
		this.name = 'IncidentNotFoundError';
	}
}

export class IncidentStateError extends DomainError {
	readonly httpStatus = 409;
	constructor(message: string) {
		super(message);
		this.name = 'IncidentStateError';
	}
}

export class IncidentValidationError extends DomainError {
	readonly httpStatus = 422;
	constructor(message: string) {
		super(message);
		this.name = 'IncidentValidationError';
	}
}

export interface Actor {
	id: string;
	name: string;
}

export interface RecordIncidentInput {
	occurredAt: Date;
	category: IncidentCategory;
	summary: string;
	description: string;
	location?: string | null;
	involvedUserId?: string | null;
}

function requireText(value: string, max: number, what: string): string {
	const trimmed = value.trim();
	if (!trimmed) throw new IncidentValidationError(`Add ${what}.`);
	if (trimmed.length > max) {
		throw new IncidentValidationError(`Keep ${what} under ${max} characters.`);
	}
	return trimmed;
}

export async function recordIncident(input: RecordIncidentInput, reporter: Actor) {
	if (Number.isNaN(input.occurredAt.getTime())) {
		throw new IncidentValidationError('Say when it happened.');
	}
	if (input.occurredAt.getTime() > Date.now() + FUTURE_TOLERANCE_MS) {
		throw new IncidentValidationError('That time is in the future.');
	}
	const location = input.location?.trim() || null;
	if (location && location.length > INCIDENT_LOCATION_MAX) {
		throw new IncidentValidationError(
			`Keep the location under ${INCIDENT_LOCATION_MAX} characters.`
		);
	}

	const now = new Date();
	const [row] = await db
		.insert(incident)
		.values({
			occurredAt: input.occurredAt,
			category: input.category,
			location,
			summary: requireText(input.summary, INCIDENT_SUMMARY_MAX, 'a summary'),
			description: requireText(input.description, INCIDENT_DESCRIPTION_MAX, 'what happened'),
			involvedUserId: input.involvedUserId || null,
			reportedByUserId: reporter.id,
			reportedByName: reporter.name,
			status: 'open',
			createdAt: now,
			updatedAt: now
		})
		.returning();
	return row;
}

async function loadStatus(id: string) {
	const [row] = await db
		.select({ id: incident.id, status: incident.status, resolution: incident.resolution })
		.from(incident)
		.where(eq(incident.id, id))
		.limit(1);
	if (!row) throw new IncidentNotFoundError();
	return row;
}

export async function addIncidentNote(incidentId: string, body: string, author: Actor) {
	const text = requireText(body, INCIDENT_NOTE_MAX, 'a note');
	await loadStatus(incidentId);

	const [row] = await db
		.insert(incidentNote)
		.values({ incidentId, authorUserId: author.id, authorName: author.name, body: text })
		.returning();
	return row;
}

export async function resolveIncident(id: string, resolution: string, staff: Actor) {
	const text = requireText(resolution, INCIDENT_NOTE_MAX, 'a resolution');
	const now = new Date();

	const [row] = await db
		.update(incident)
		.set({
			status: 'resolved',
			resolution: text,
			resolvedByUserId: staff.id,
			resolvedAt: now,
			updatedAt: now
		})
		.where(and(eq(incident.id, id), eq(incident.status, 'open')))
		.returning();
	if (row) return row;

	await loadStatus(id);
	throw new IncidentStateError('That incident is already resolved.');
}

/**
 * Open it again. The resolution being set aside is kept as a note first, so
 * "we thought this was dealt with on the 3rd" stays on the record.
 */
export async function reopenIncident(id: string, staff: Actor) {
	const current = await loadStatus(id);
	if (current.status !== 'resolved') {
		throw new IncidentStateError('That incident is already open.');
	}

	if (current.resolution) {
		await db.insert(incidentNote).values({
			incidentId: id,
			authorUserId: staff.id,
			authorName: staff.name,
			body: `Reopened. Previous resolution: ${current.resolution}`
		});
	}

	const [row] = await db
		.update(incident)
		.set({
			status: 'open',
			resolution: null,
			resolvedByUserId: null,
			resolvedAt: null,
			updatedAt: new Date()
		})
		.where(and(eq(incident.id, id), eq(incident.status, 'resolved')))
		.returning();
	if (!row) throw new IncidentStateError('That incident changed while you were looking at it.');
	return row;
}

export async function getIncident(id: string) {
	const [row] = await db
		.select({ incident, involvedName: user.name })
		.from(incident)
		.leftJoin(user, eq(user.id, incident.involvedUserId))
		.where(eq(incident.id, id))
		.limit(1);
	if (!row) throw new IncidentNotFoundError();

	const notes = await db
		.select()
		.from(incidentNote)
		.where(eq(incidentNote.incidentId, id))
		.orderBy(asc(incidentNote.createdAt), asc(incidentNote.id));

	return { ...row.incident, involvedName: row.involvedName, notes };
}

export interface IncidentFilters {
	status?: IncidentStatus;
	category?: IncidentCategory;
	search?: string;
	involvedUserId?: string;
}

/** Newest first: this is read back as a log, not worked as a queue. */
export async function listIncidents(filters: IncidentFilters, pagination: PaginationInput) {
	const term = filters.search?.trim();
	const where = and(
		filters.status ? eq(incident.status, filters.status) : undefined,
		filters.category ? eq(incident.category, filters.category) : undefined,
		filters.involvedUserId ? eq(incident.involvedUserId, filters.involvedUserId) : undefined,
		term
			? or(
					containsLiteral(incident.summary, term),
					containsLiteral(incident.description, term),
					containsLiteral(incident.location, term)
				)
			: undefined
	);

	const dataQ = db
		.select({
			id: incident.id,
			occurredAt: incident.occurredAt,
			category: incident.category,
			location: incident.location,
			summary: incident.summary,
			status: incident.status,
			reportedByName: incident.reportedByName,
			involvedName: user.name
		})
		.from(incident)
		.leftJoin(user, eq(user.id, incident.involvedUserId))
		.where(where)
		.orderBy(desc(incident.occurredAt), desc(incident.id))
		.$dynamic();

	const countQ = db.select({ count: count() }).from(incident).where(where);

	return paginate(dataQ, countQ, pagination);
}
