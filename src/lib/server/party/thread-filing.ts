import { db } from '#lib/server/db/index.js';
import { inboxThread } from '#lib/server/db/schema/inbox.js';
import { and, desc, eq, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import { DomainError } from '#lib/server/domain-error.js';
import type { FeedItem, FeedPage } from '#lib/types/activity.js';
import type { PartyRef } from './activity-service';
import { partyKey } from './party-key';

/**
 * Filing a staff Inbox conversation to an outside party (#2622), so it shows
 * on that organization's or person's timeline. A thread is filed to at most
 * one party. Band threads belong to their band and are never filed. The
 * remotes guard: `contact.manage` and `inbox.reply` file, `contact.read` reads.
 */

export class ThreadFilingError extends DomainError {
	readonly httpStatus = 422;
	constructor() {
		super('Only a staff Inbox conversation can be filed.');
	}
}

export class ThreadNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('Thread not found');
	}
}

const filedTo = (party: PartyRef): SQL =>
	party.type === 'organization'
		? eq(inboxThread.organizationId, party.id)
		: eq(inboxThread.contactId, party.id);

/** File the thread to `party`, or unfile it with null. */
export async function fileThread(threadId: string, party: PartyRef | null): Promise<void> {
	const [thread] = await db
		.select({ groupId: inboxThread.groupId })
		.from(inboxThread)
		.where(eq(inboxThread.id, threadId))
		.limit(1);
	if (!thread) throw new ThreadNotFoundError();
	if (thread.groupId) throw new ThreadFilingError();
	await db
		.update(inboxThread)
		.set({
			organizationId: party?.type === 'organization' ? party.id : null,
			contactId: party?.type === 'contact' ? party.id : null,
			updatedAt: new Date()
		})
		.where(eq(inboxThread.id, threadId));
}

/** Where a thread is filed, and the address a suggestion is matched on. */
export async function threadFiling(threadId: string) {
	const [row] = await db
		.select({
			groupId: inboxThread.groupId,
			organizationId: inboxThread.organizationId,
			contactId: inboxThread.contactId,
			contactEmail: inboxThread.contactEmail
		})
		.from(inboxThread)
		.where(eq(inboxThread.id, threadId))
		.limit(1);
	if (!row) throw new ThreadNotFoundError();
	return row;
}

export type ThreadTimelineItem = FeedItem & { source: 'thread'; threadId: string };

/** The conversations filed to a party, by latest message, for its timeline. */
export async function filedThreads(
	party: PartyRef,
	limit: number
): Promise<FeedPage<ThreadTimelineItem>> {
	const at = sql<Date>`coalesce(${inboxThread.lastMessageAt}, ${inboxThread.createdAt})`.mapWith(
		inboxThread.createdAt
	);
	const rows = await db
		.select({
			id: inboxThread.id,
			at,
			subject: inboxThread.subject,
			preview: inboxThread.preview,
			contactName: inboxThread.contactName
		})
		.from(inboxThread)
		.where(and(filedTo(party), isNull(inboxThread.deletedAt)))
		.orderBy(desc(at), desc(inboxThread.id))
		.limit(limit + 1);
	return {
		items: rows.slice(0, limit).map((r) => ({
			source: 'thread',
			id: `thread:${r.id}`,
			at: r.at,
			actorId: null,
			actorName: r.contactName,
			summary: r.subject || r.preview || '',
			threadId: r.id
		})),
		hasMore: rows.length > limit
	};
}

/** Each party's latest filed message, keyed by `partyKey`, for the Contacts list. */
export async function lastThreadByParty(): Promise<Map<string, Date>> {
	const rows = await db
		.select({
			organizationId: inboxThread.organizationId,
			contactId: inboxThread.contactId,
			last: sql<number>`max(coalesce(${inboxThread.lastMessageAt}, ${inboxThread.createdAt}))`
		})
		.from(inboxThread)
		.where(
			and(
				or(isNotNull(inboxThread.organizationId), isNotNull(inboxThread.contactId)),
				isNull(inboxThread.deletedAt)
			)
		)
		.groupBy(inboxThread.organizationId, inboxThread.contactId);
	return new Map(
		rows.map((r) => [
			partyKey(
				r.organizationId
					? { type: 'organization', id: r.organizationId }
					: { type: 'contact', id: r.contactId! }
			),
			new Date(Number(r.last) * 1000)
		])
	);
}

/** Move one party's filed threads onto another, for a merge's batch. */
export function moveThreads(from: PartyRef, to: PartyRef) {
	return db
		.update(inboxThread)
		.set(
			to.type === 'organization'
				? { organizationId: to.id, contactId: null }
				: { organizationId: null, contactId: to.id }
		)
		.where(filedTo(from));
}
