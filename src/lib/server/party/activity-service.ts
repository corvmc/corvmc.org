import { db } from '#lib/server/db/index.js';
import { activity } from '#lib/server/db/schema/activity.js';
import { desc, eq, sql, type SQL } from 'drizzle-orm';
import { DomainError } from '#lib/server/domain-error.js';
import { partyKey } from './party-key';
import { ACTIVITY_BODY_MAX, type ActivityKind } from '#lib/config.js';

/**
 * What staff log on an organization's or a person's timeline (#2622): a call,
 * a meeting, an email or a note. The remotes guard: `contact.manage` writes,
 * `contact.read` reads.
 */

export class ActivityNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('Note not found');
	}
}

export class ActivityValidationError extends DomainError {
	readonly httpStatus = 422;
}

/** Whose timeline a note is on. Exactly one is set. */
export type PartyRef = { type: 'organization' | 'contact'; id: string };

export interface ActivityInput {
	kind: ActivityKind;
	/** `YYYY-MM-DD`, a club date. */
	occurredOn: string;
	body: string;
}

function valid(input: ActivityInput): ActivityInput {
	const body = input.body.trim();
	if (!body) throw new ActivityValidationError('Say what happened.');
	if (body.length > ACTIVITY_BODY_MAX) {
		throw new ActivityValidationError(`Keep it under ${ACTIVITY_BODY_MAX} characters.`);
	}
	if (!/^\d{4}-\d{2}-\d{2}$/.test(input.occurredOn)) {
		throw new ActivityValidationError('Pick the day it happened.');
	}
	return { ...input, body };
}

const ownerColumns = (party: PartyRef) =>
	party.type === 'organization'
		? { organizationId: party.id, contactId: null }
		: { organizationId: null, contactId: party.id };

export const ownedBy = (party: PartyRef): SQL =>
	party.type === 'organization'
		? eq(activity.organizationId, party.id)
		: eq(activity.contactId, party.id);

export async function addActivity(
	party: PartyRef,
	input: ActivityInput,
	authorUserId: string
): Promise<{ id: string }> {
	const [row] = await db
		.insert(activity)
		.values({ ...ownerColumns(party), ...valid(input), authorUserId })
		.returning({ id: activity.id });
	return row;
}

export async function updateActivity(id: string, input: ActivityInput): Promise<PartyRef> {
	const [row] = await db
		.update(activity)
		.set({ ...valid(input), updatedAt: new Date() })
		.where(eq(activity.id, id))
		.returning({ organizationId: activity.organizationId, contactId: activity.contactId });
	if (!row) throw new ActivityNotFoundError();
	return ownerOf(row);
}

export async function deleteActivity(id: string): Promise<PartyRef> {
	const [row] = await db
		.delete(activity)
		.where(eq(activity.id, id))
		.returning({ organizationId: activity.organizationId, contactId: activity.contactId });
	if (!row) throw new ActivityNotFoundError();
	return ownerOf(row);
}

function ownerOf(row: { organizationId: string | null; contactId: string | null }): PartyRef {
	return row.organizationId
		? { type: 'organization', id: row.organizationId }
		: { type: 'contact', id: row.contactId! };
}

/** A party's notes, newest first, read with `limit` for a feed. */
export async function listActivity(party: PartyRef, limit: number) {
	return db
		.select({
			id: activity.id,
			kind: activity.kind,
			occurredOn: activity.occurredOn,
			body: activity.body,
			authorUserId: activity.authorUserId,
			createdAt: activity.createdAt
		})
		.from(activity)
		.where(ownedBy(party))
		.orderBy(desc(activity.occurredOn), desc(activity.createdAt), desc(activity.id))
		.limit(limit);
}

/** Each party's latest note day, keyed by `partyKey`, for the Contacts list. */
export async function lastActivityByParty(): Promise<Map<string, string>> {
	// Grouped over every party rather than bound per id: D1 caps parameters at 100.
	const rows = await db
		.select({
			organizationId: activity.organizationId,
			contactId: activity.contactId,
			last: sql<string>`max(${activity.occurredOn})`
		})
		.from(activity)
		.groupBy(activity.organizationId, activity.contactId);
	return new Map(rows.map((r) => [partyKey(ownerOf(r)), r.last]));
}

/** Move one party's notes onto another, for a merge. Returned for the merge's batch. */
export function moveActivity(from: PartyRef, to: PartyRef) {
	return db
		.update(activity)
		.set({ ...ownerColumns(to), updatedAt: new Date() })
		.where(ownedBy(from));
}
