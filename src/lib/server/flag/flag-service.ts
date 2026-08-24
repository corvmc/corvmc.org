import { db } from '$lib/server/db';
import { toBandRef, toFlagTargetRef } from '$lib/server/entity/refs';
import { DomainError } from '../domain-error';
import { contentFlag } from '$lib/server/db/schema/flag';
import type { FlagEntityType, FlagStatus } from '$lib/server/db/schema/flag';
import type { StandingScope } from '$lib/config';
import { user } from '$lib/server/db/schema/authentication';
import { band } from '$lib/server/db/schema/band';
import { event } from '$lib/server/db/schema/event';
import { inboxThread, inboxMessage, inboxParticipant } from '$lib/server/db/schema/inbox';
import type { InboxMessageDirection } from '$lib/server/db/schema/inbox';
import { suggestion } from '$lib/server/db/schema/suggestion';
import { eq, ne, and, desc, count, like, inArray, getTableColumns } from 'drizzle-orm';
import { paginate, type PaginationInput } from '$lib/server/db/paginate';
import { domainEvents } from '$lib/server/events/event-bus';
import { captureException } from '$lib/server/sentry';

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export const FLAG_REASON_MAX = 100;
export const FLAG_DESCRIPTION_MAX = 1000;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class FlagNotFoundError extends DomainError {
	readonly httpStatus = 404;

	constructor() {
		super('Flag not found');
		this.name = 'FlagNotFoundError';
	}
}

export class FlagTargetNotFoundError extends DomainError {
	readonly httpStatus = 404;

	constructor() {
		super('The content being reported could not be found');
		this.name = 'FlagTargetNotFoundError';
	}
}

export class FlagAlreadyResolvedError extends DomainError {
	readonly httpStatus = 409;

	constructor() {
		super('This flag has already been resolved');
		this.name = 'FlagAlreadyResolvedError';
	}
}

/**
 * What a reported conversation is called everywhere staff can see it before
 * opening the report. Never the subject, never the preview.
 */
export const DIRECT_CONVERSATION_LABEL = 'Direct conversation';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function entityHref(entityType: FlagEntityType, entityId: string, flagId?: string): string {
	switch (entityType) {
		case 'band_profile':
			return `/staff/bands/${entityId}`;
		// A private conversation has no staff page of its own — by design, see
		// getThread(). The report *is* the only way in, so link to the report.
		case 'inbox_thread':
			return flagId ? `/staff/flags/${flagId}` : '/staff/flags';
		// Events have no staff record page for band events; the public listing is
		// the canonical URL for both sources.
		case 'event':
			return `/events/${entityId}`;
		case 'suggestion':
			return `/staff/suggestions/${entityId}`;
		default:
			return `/staff/users/${entityId}`;
	}
}

/** Resolve a display name for a flagged entity, or null if it no longer exists. */
async function resolveEntityLabel(
	entityType: FlagEntityType,
	entityId: string
): Promise<string | null> {
	if (entityType === 'band_profile') {
		const [row] = await db
			.select({ name: band.name })
			.from(band)
			.where(eq(band.id, entityId))
			.limit(1);
		return row?.name ?? null;
	}
	if (entityType === 'event') {
		const [row] = await db
			.select({ title: event.title })
			.from(event)
			.where(eq(event.id, entityId))
			.limit(1);
		return row?.title ?? null;
	}
	if (entityType === 'suggestion') {
		const [row] = await db
			.select({ title: suggestion.title })
			.from(suggestion)
			.where(eq(suggestion.id, entityId))
			.limit(1);
		return row?.title ?? null;
	}
	if (entityType === 'inbox_thread') {
		// A deliberately content-free constant — note this differs from every
		// other arm here, which return the thing's own title or name. `listFlags`
		// renders entityLabel straight into the staff queue, so returning the
		// subject or preview would put a member's private words in front of staff
		// before anyone has opened the report. Existence is all we confirm.
		const [row] = await db
			.select({ id: inboxThread.id })
			.from(inboxThread)
			.where(and(eq(inboxThread.id, entityId), eq(inboxThread.channel, 'direct')))
			.limit(1);
		return row ? DIRECT_CONVERSATION_LABEL : null;
	}
	const [row] = await db
		.select({ name: user.name })
		.from(user)
		.where(eq(user.id, entityId))
		.limit(1);
	return row?.name ?? null;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export interface CreateFlagParams {
	entityType: FlagEntityType;
	entityId: string;
	/** Absent for anonymous public reports (event listings). */
	reportedByUserId?: string;
	reportedByName?: string;
	reason: string;
	description?: string;
}

export async function createFlag(params: CreateFlagParams) {
	const entityLabel = await resolveEntityLabel(params.entityType, params.entityId);
	if (entityLabel === null) throw new FlagTargetNotFoundError();

	// If this entity already has a pending flag, repeat reports pile onto the
	// existing queue item without re-notifying every staff member.
	const [duplicate] = await db
		.select({ id: contentFlag.id })
		.from(contentFlag)
		.where(
			and(
				eq(contentFlag.entityType, params.entityType),
				eq(contentFlag.entityId, params.entityId),
				eq(contentFlag.status, 'pending')
			)
		)
		.limit(1);

	const [flag] = await db
		.insert(contentFlag)
		.values({
			entityType: params.entityType,
			entityId: params.entityId,
			reportedByUserId: params.reportedByUserId ?? null,
			reason: params.reason.slice(0, FLAG_REASON_MAX),
			description: params.description?.slice(0, FLAG_DESCRIPTION_MAX) || null
		})
		.returning();

	// A report is enough to pull a suggestion off the board — unlike an event
	// listing, which a report deliberately does not move (those can be filed
	// anonymously by any visitor). Dynamic import for the same reason resolveFlag
	// uses one below: it keeps the two domains from importing each other.
	// withholdForReview only moves `visible` rows, so repeat reports are no-ops.
	if (params.entityType === 'suggestion') {
		const { withholdForReview } = await import('$lib/server/suggestion/suggestion-service');
		await withholdForReview(params.entityId, { flagId: flag.id });
	}

	// Fire-and-forget: notify staff without blocking the reporter's request.
	if (!duplicate) {
		Promise.resolve().then(async () => {
			try {
				await domainEvents.emit('content.flagged', {
					flagId: flag.id,
					entityType: flag.entityType,
					entityId: flag.entityId,
					entityLabel,
					reason: flag.reason,
					reportedByUserId: params.reportedByUserId ?? null,
					reportedByName: params.reportedByName ?? 'Anonymous visitor'
				});
			} catch (err) {
				captureException(err, { event: 'content.flagged', flagId: flag.id });
			}
		});
	}

	return flag;
}

/**
 * How many of this member's reports are still sitting unresolved in the queue.
 *
 * The exact, self-clearing half of the anti-spam pair — the same shape as
 * MAX_PENDING_SENT_REQUESTS. Better than a daily quota here because reporting
 * auto-blocks: someone having a genuinely bad week should be able to report
 * again the moment staff work through the backlog, while someone filing junk to
 * bury the queue stops at the cap until staff look.
 *
 * `createFlag` already collapses repeat reports about the *same* entity; this
 * covers reports spread across many.
 */
export async function countUnresolvedReportsBy(reporterUserId: string): Promise<number> {
	const [row] = await db
		.select({ count: count() })
		.from(contentFlag)
		.where(
			and(eq(contentFlag.reportedByUserId, reporterUserId), eq(contentFlag.status, 'pending'))
		);
	return row?.count ?? 0;
}

export interface ResolveFlagParams {
	resolution: Extract<FlagStatus, 'resolved' | 'dismissed'>;
	notes?: string;
	staffId: string;
	/** For event flags: also drop the event back to draft (off the public guide). */
	unpublishEvent?: boolean;
}

export async function resolveFlag(flagId: string, params: ResolveFlagParams) {
	const [existing] = await db
		.select({
			status: contentFlag.status,
			entityType: contentFlag.entityType,
			entityId: contentFlag.entityId
		})
		.from(contentFlag)
		.where(eq(contentFlag.id, flagId))
		.limit(1);

	if (!existing) throw new FlagNotFoundError();
	if (existing.status !== 'pending') throw new FlagAlreadyResolvedError();

	const [row] = await db
		.update(contentFlag)
		.set({
			status: params.resolution,
			resolutionNotes: params.notes?.slice(0, FLAG_DESCRIPTION_MAX) || null,
			resolvedByUserId: params.staffId,
			resolvedAt: new Date(),
			updatedAt: new Date()
		})
		.where(eq(contentFlag.id, flagId))
		.returning();

	if (params.resolution === 'resolved' && existing.entityType === 'event') {
		if (params.unpublishEvent) {
			const { unpublishWithNotice } = await import('$lib/server/event/event-service');
			await unpublishWithNotice(existing.entityId, { notes: params.notes });
		}
	}

	if (existing.entityType === 'suggestion') {
		const svc = await import('$lib/server/suggestion/suggestion-service');

		if (params.resolution === 'resolved') {
			// Upheld: off the board for good. The author's standing is handled above,
			// with every other scope — same rule as community listings.
			await svc.setVisibility(existing.entityId, {
				visibility: 'hidden',
				note: params.notes,
				staffId: params.staffId
			});
		} else {
			// Dismissed: straight back on the board, author untouched.
			//
			// Note the asymmetry with events above, which do NOTHING on dismissal.
			// An event report can be filed anonymously by any visitor, so a bare
			// accusation must not move anything. A suggestion report is
			// authenticated and member-only, AND it has already hidden the post — so
			// leaving it hidden on dismissal would hand every member a permanent
			// takedown button. Dismissal MUST restore.
			await svc.setVisibility(existing.entityId, {
				visibility: 'visible',
				note: null,
				staffId: params.staffId
			});
		}
	}

	// An *upheld* report is the only thing that costs a member their standing. A
	// dismissed one deliberately does nothing: event reports are public and
	// anonymous, so letting a bare accusation trip probation would hand any
	// visitor a griefing tool. This is the single place the rule is wired.
	//
	// Which standing it costs is `scopeForFlag`'s answer, and it is NOT the
	// identity function — an event report only touches standing when the event is
	// a member's own community listing. Who pays is a different question per
	// entity, and stays a per-branch lookup: the listing's submitter, the
	// suggestion's author, or the participant who is not the reporter.
	if (params.resolution === 'resolved') {
		const subject = await standingSubjectOf(existing.entityType, existing.entityId, {
			reporterUserId: row.reportedByUserId
		});

		if (subject) {
			const { restrictStanding } = await import('$lib/server/moderation/standing-service');
			await restrictStanding({
				userId: subject.userId,
				scope: subject.scope,
				flagId,
				staffId: params.staffId,
				reason: params.notes
			});
		}
	}

	return row;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export interface FlagFilters {
	status?: FlagStatus;
	search?: string;
	/** `entityType` + `entityId` together address one flagged subject — a member
	 *  profile is `('member_profile', user.id)`. Either alone is a wider net. */
	entityType?: FlagEntityType;
	entityId?: string;
	/** Flags this user filed, as opposed to flags filed against them. */
	reportedByUserId?: string;
}

export async function listFlags(filters: FlagFilters, pagination: PaginationInput) {
	const conditions = [];
	if (filters.status) conditions.push(eq(contentFlag.status, filters.status));
	if (filters.search?.trim()) {
		conditions.push(like(contentFlag.reason, `%${filters.search.trim()}%`));
	}
	if (filters.entityType) conditions.push(eq(contentFlag.entityType, filters.entityType));
	if (filters.entityId) conditions.push(eq(contentFlag.entityId, filters.entityId));
	if (filters.reportedByUserId) {
		conditions.push(eq(contentFlag.reportedByUserId, filters.reportedByUserId));
	}
	const where = conditions.length ? and(...conditions) : undefined;

	const dataQ = db
		.select({
			id: contentFlag.id,
			entityType: contentFlag.entityType,
			entityId: contentFlag.entityId,
			reason: contentFlag.reason,
			status: contentFlag.status,
			createdAt: contentFlag.createdAt,
			reportedByName: user.name
		})
		.from(contentFlag)
		.leftJoin(user, eq(user.id, contentFlag.reportedByUserId))
		.where(where)
		.orderBy(desc(contentFlag.createdAt))
		.$dynamic();

	const countQ = db.select({ count: count() }).from(contentFlag).where(where);

	const { rows, pagination: pageInfo } = await paginate(dataQ, countQ, pagination);

	// Resolve entity labels in batched per-type lookups (no N+1).
	const memberIds = rows.filter((r) => r.entityType === 'member_profile').map((r) => r.entityId);
	const bandIds = rows.filter((r) => r.entityType === 'band_profile').map((r) => r.entityId);
	const eventIds = rows.filter((r) => r.entityType === 'event').map((r) => r.entityId);
	const suggestionIds = rows.filter((r) => r.entityType === 'suggestion').map((r) => r.entityId);

	const memberNames = memberIds.length
		? await db
				.select({ id: user.id, name: user.name })
				.from(user)
				.where(inArray(user.id, memberIds))
		: [];
	const bandNames = bandIds.length
		? await db.select({ id: band.id, name: band.name }).from(band).where(inArray(band.id, bandIds))
		: [];
	const eventTitles = eventIds.length
		? await db
				.select({ id: event.id, title: event.title })
				.from(event)
				.where(inArray(event.id, eventIds))
		: [];
	const suggestionTitles = suggestionIds.length
		? await db
				.select({ id: suggestion.id, title: suggestion.title })
				.from(suggestion)
				.where(inArray(suggestion.id, suggestionIds))
		: [];

	const labelMap = new Map<string, string>();
	for (const m of memberNames) labelMap.set(`member_profile:${m.id}`, m.name);
	for (const b of bandNames) labelMap.set(`band_profile:${b.id}`, b.name);
	for (const e of eventTitles) labelMap.set(`event:${e.id}`, e.title);
	for (const sg of suggestionTitles) labelMap.set(`suggestion:${sg.id}`, sg.title);
	// Conversations get the same content-free label, with no lookup: there is
	// nothing about a private thread that belongs in a queue listing.
	for (const r of rows) {
		if (r.entityType === 'inbox_thread') {
			labelMap.set(`inbox_thread:${r.entityId}`, DIRECT_CONVERSATION_LABEL);
		}
	}

	return {
		rows: rows.map((r) => {
			const label = labelMap.get(`${r.entityType}:${r.entityId}`) ?? null;
			return {
				...r,
				entityLabel: label ?? '(deleted)',
				entityHref: entityHref(r.entityType, r.entityId, r.id),
				// The queue row *is* the report, and it opens the report — so the
				// row's own identity is the flag, titled by what was reported. The
				// target rides along for the type badge beside it.
				ref: { type: 'flag' as const, id: r.id, title: label ?? '(deleted)' },
				target: toFlagTargetRef(r.entityType, r.entityId, label)
			};
		}),
		pagination: pageInfo
	};
}

interface StandingSubject {
	userId: string;
	scope: StandingScope;
}

/**
 * Who an upheld report costs, and in which scope — or null when it costs nobody.
 *
 * Two questions live here and they are not the same one. `scopeForFlag` answers
 * *which standing*, and it is deliberately not the identity function: an `event`
 * report only touches standing when the event is a member's community listing,
 * because a CMC or band gig has no member to hold responsible. *Who pays* is
 * genuinely different per entity, so it stays a branch — the listing's
 * submitter, the suggestion's author, the participant who is not the reporter.
 *
 * Dynamic imports for the same reason `createFlag` uses one: they keep the
 * domains from importing each other.
 */
async function standingSubjectOf(
	entityType: FlagEntityType,
	entityId: string,
	context: { reporterUserId: string | null }
): Promise<StandingSubject | null> {
	const { scopeForFlag } = await import('$lib/server/moderation/standing-service');

	switch (entityType) {
		case 'event': {
			const { getById } = await import('$lib/server/event/event-service');
			const evt = await getById(entityId);
			const scope = scopeForFlag('event', { eventSource: evt?.source });
			return scope && evt ? { userId: evt.createdByUserId, scope } : null;
		}
		case 'suggestion': {
			const { getSuggestionForModeration } =
				await import('$lib/server/suggestion/suggestion-service');
			const target = await getSuggestionForModeration(entityId);
			const scope = scopeForFlag('suggestion');
			// Null when the author has deleted their account: there is nobody left
			// to put on review, and the post is hidden either way.
			return target?.authorUserId && scope ? { userId: target.authorUserId, scope } : null;
		}
		case 'inbox_thread': {
			const reported = await reportedPartyOf(entityId, context.reporterUserId);
			const scope = scopeForFlag('inbox_thread');
			return reported && scope ? { userId: reported, scope } : null;
		}
		default:
			return null;
	}
}

/**
 * The participant a conversation report is *about*: the one who is not the
 * reporter.
 *
 * Returns null when the reporter is unknown (they deleted their account —
 * `reported_by_user_id` is set-null) or when a party has been purged. Staff can
 * still read the thread and act by hand; we just do not guess who to restrict.
 */
async function reportedPartyOf(
	threadId: string,
	reporterUserId: string | null
): Promise<string | null> {
	if (!reporterUserId) return null;
	const [row] = await db
		.select({ userId: inboxParticipant.userId })
		.from(inboxParticipant)
		.where(
			and(eq(inboxParticipant.threadId, threadId), ne(inboxParticipant.userId, reporterUserId))
		)
		.limit(1);
	return row?.userId ?? null;
}

export interface FlaggedThreadContext {
	threadId: string;
	status: string;
	messageCount: number;
	createdAt: Date;
	participants: { userId: string; name: string; isReporter: boolean }[];
	messages: {
		id: string;
		body: string;
		authorName: string | null;
		authorUserId: string | null;
		/** Narrowed, not `string`: ThreadTimeline discriminates on it. */
		direction: InboxMessageDirection;
		createdAt: Date;
	}[];
}

/**
 * A reported conversation, in full, for the triage page.
 *
 * **Keyed on the flag, not on the thread.** That is the whole design: staff have
 * no way to name a direct thread and ask for it — `getThread` refuses them, and
 * `listThreads` hides them. The only handle is a report, and this function will
 * not answer without one.
 *
 * The whole history comes back, not just a reported message. You cannot judge
 * harassment from one line out of context.
 *
 * No condition on the flag's status: a resolved report stays re-readable, which
 * staff need for appeals and repeat offenders. The flag row is still the key, so
 * this does not widen who can reach a conversation.
 */
export async function getFlaggedDirectThread(flagId: string): Promise<FlaggedThreadContext | null> {
	const [thread] = await db
		.select({
			threadId: inboxThread.id,
			status: inboxThread.status,
			messageCount: inboxThread.messageCount,
			createdAt: inboxThread.createdAt,
			reportedByUserId: contentFlag.reportedByUserId
		})
		.from(contentFlag)
		.innerJoin(
			inboxThread,
			and(
				eq(contentFlag.entityType, 'inbox_thread'),
				eq(inboxThread.id, contentFlag.entityId),
				eq(inboxThread.channel, 'direct')
			)
		)
		.where(eq(contentFlag.id, flagId))
		.limit(1);

	if (!thread) return null;

	const participants = await db
		.select({ userId: inboxParticipant.userId, name: user.name })
		.from(inboxParticipant)
		.innerJoin(user, eq(user.id, inboxParticipant.userId))
		.where(eq(inboxParticipant.threadId, thread.threadId));

	const messages = await db
		.select({
			id: inboxMessage.id,
			body: inboxMessage.body,
			authorName: inboxMessage.authorName,
			authorUserId: inboxMessage.authorUserId,
			direction: inboxMessage.direction,
			createdAt: inboxMessage.createdAt
		})
		.from(inboxMessage)
		.where(eq(inboxMessage.threadId, thread.threadId))
		.orderBy(inboxMessage.createdAt);

	return {
		threadId: thread.threadId,
		status: thread.status,
		messageCount: thread.messageCount,
		createdAt: thread.createdAt,
		participants: participants.map((p) => ({
			...p,
			isReporter: p.userId === thread.reportedByUserId
		})),
		messages
	};
}

export interface FlaggedEventContext {
	title: string;
	startsAt: Date;
	location: string | null;
	status: string;
	source: string;
	band: { id: string; name: string; slug: string } | null;
}

export async function getFlag(flagId: string) {
	const [row] = await db
		.select({
			flag: getTableColumns(contentFlag),
			reportedByName: user.name,
			reportedByEmail: user.email
		})
		.from(contentFlag)
		.leftJoin(user, eq(user.id, contentFlag.reportedByUserId))
		.where(eq(contentFlag.id, flagId))
		.limit(1);

	if (!row) throw new FlagNotFoundError();

	const entityLabel = await resolveEntityLabel(row.flag.entityType, row.flag.entityId);
	const eventContext =
		row.flag.entityType === 'event' ? await resolveEventContext(row.flag.entityId) : null;
	// The report being open is what makes reading appropriate, so the
	// conversation loads with the page — there is nothing further to gate on.
	const threadContext =
		row.flag.entityType === 'inbox_thread' ? await getFlaggedDirectThread(flagId) : null;

	return {
		...row.flag,
		reportedByName: row.reportedByName,
		reportedByEmail: row.reportedByEmail,
		entityLabel: entityLabel ?? '(deleted)',
		entityHref: entityHref(row.flag.entityType, row.flag.entityId, flagId),
		/** The reported record itself, so the page stops rebuilding its route. */
		target: toFlagTargetRef(row.flag.entityType, row.flag.entityId, entityLabel),
		eventContext,
		// The credited band as a record. The flagged *target* is still resolved by
		// the page's own href map — that is the polymorphic case, and it is the
		// next thing to fold onto a ref.
		eventBandRef: eventContext?.band ? toBandRef(eventContext.band) : null,
		threadContext
	};
}

/** Event details shown on the flag triage page so staff can judge in place. */
async function resolveEventContext(eventId: string): Promise<FlaggedEventContext | null> {
	const [row] = await db
		.select({
			title: event.title,
			startsAt: event.startsAt,
			location: event.location,
			status: event.status,
			source: event.source,
			bandId: band.id,
			bandName: band.name,
			bandSlug: band.slug
		})
		.from(event)
		.leftJoin(band, eq(band.id, event.bandId))
		.where(eq(event.id, eventId))
		.limit(1);

	if (!row) return null;

	return {
		title: row.title,
		startsAt: row.startsAt,
		location: row.location,
		status: row.status,
		source: row.source,
		band:
			row.bandId && row.bandName && row.bandSlug
				? { id: row.bandId, name: row.bandName, slug: row.bandSlug }
				: null
	};
}
