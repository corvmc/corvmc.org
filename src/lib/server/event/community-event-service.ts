import { db } from '$lib/server/db';
import { event, type LineupEntry } from '$lib/server/db/schema/event';
import { user } from '$lib/server/db/schema/authentication';
import { and, asc, count, eq, getTableColumns, gte, inArray, like, ne } from 'drizzle-orm';
import { paginate, type PaginationInput } from '$lib/server/db/paginate';
import { uploadFile, deleteObject } from '$lib/server/storage';
import { mediaKey } from '$lib/server/storage-keys';
import { domainEvents } from '$lib/server/events/event-bus';
import { captureException } from '$lib/server/sentry';
import { allowRateLimited } from '$lib/server/rate-limit';
import { getStanding } from '$lib/server/moderation/standing-service';
import { DomainError } from '$lib/server/errors';
import {
	getById,
	publish as publishEvent,
	unpublish as unpublishEvent,
	setEventLineup,
	type EventRow
} from './event-service';

// ---------------------------------------------------------------------------
// CommunityEventService — member-authored listings for the public gig guide
// ---------------------------------------------------------------------------
// A community listing is an off-site show a member knows about: a gig at
// another venue, a house show, a festival. The member owns it end to end —
// draft it, edit it, publish it — exactly as a band admin owns their band's
// gigs.
//
// Two rules shape everything here:
//
//   1. CMC never sells a show it doesn't produce. None of these functions
//      take a `ticketingEnabled` parameter, so the flag is unreachable from
//      this file the same way it is from createBandEvent. A door price and an
//      external ticket link are fine — they describe where someone *else*
//      sells.
//
//   2. Publishing is direct until a member gives us a reason it shouldn't be.
//      `member_standing` scoped to `community_event` records that reason.
//
// Authorization lives in the remote layer, as it does across this codebase.
// What lives here is *ownership*, threaded through the arguments the same way
// updateBandEvent takes a bandId — a caller cannot ask this service to touch a
// listing without saying whose it is.
// ---------------------------------------------------------------------------

/** Publishes per hour, per member. Loose enough that a real person never sees it. */
const PUBLISH_RATE_MAX = 20;
const PUBLISH_RATE_WINDOW_SECONDS = 3600;

export class ListingNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('Listing not found');
	}
}

/**
 * 404 rather than 403, deliberately: "this exists but isn't yours" tells a
 * stranger a listing id is real. Not-found is the same answer either way.
 */
export class NotListingOwnerError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('Listing not found');
	}
}

export class ListingStatusError extends DomainError {
	readonly httpStatus = 422;
}

export class PublishRateLimitedError extends DomainError {
	readonly httpStatus = 429;
	constructor() {
		super('You have published a lot of listings just now — try again in a little while');
	}
}

export type { EventRow } from './event-service';

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** The member's own listings, drafts included. Nobody else's, ever. */
export async function listCommunityEventsForUser(userId: string): Promise<EventRow[]> {
	return db
		.select()
		.from(event)
		.where(
			and(
				eq(event.source, 'community'),
				eq(event.createdByUserId, userId),
				ne(event.status, 'rejected')
			)
		)
		.orderBy(asc(event.startsAt));
}

/** Rejected listings, split out so the UI can lead with "these need your attention". */
export async function listRejectedForUser(userId: string): Promise<EventRow[]> {
	return db
		.select()
		.from(event)
		.where(
			and(
				eq(event.source, 'community'),
				eq(event.createdByUserId, userId),
				eq(event.status, 'rejected')
			)
		)
		.orderBy(asc(event.startsAt));
}

/**
 * The staff review queue.
 *
 * Keyed on `status='pending_review'` and NOT on source — drafts are excluded
 * structurally rather than by convention, so a member's half-written listing can
 * never surface here, and the deferred booking-request pipeline can share this
 * queue later without reshaping it.
 */
export async function listPendingSubmissions(pagination: PaginationInput = {}) {
	const where = eq(event.status, 'pending_review');

	const dataQ = db
		.select({
			...getTableColumns(event),
			submitterName: user.name,
			submitterId: user.id
		})
		.from(event)
		.innerJoin(user, eq(user.id, event.createdByUserId))
		.where(where)
		.orderBy(asc(event.startsAt))
		.$dynamic();
	const countQ = db.select({ count: count() }).from(event).where(where);
	return paginate(dataQ, countQ, pagination);
}

export async function countPendingSubmissions(): Promise<number> {
	const [row] = await db
		.select({ value: count() })
		.from(event)
		.where(eq(event.status, 'pending_review'));
	return row?.value ?? 0;
}

export interface DuplicateMatch {
	id: string;
	title: string;
	startsAt: Date;
}

/**
 * Look for an existing public listing of what looks like the same show.
 *
 * Advisory only — the caller warns, never blocks. Two people posting the same
 * gig is the characteristic failure of a community calendar, and the common
 * case is honest (the second person didn't know). A determined duplicate isn't
 * stopped by anything short of moderation, so this doesn't pretend to try.
 */
export async function checkForDuplicate(params: {
	title: string;
	startsAt: Date;
	excludeEventId?: string;
}): Promise<DuplicateMatch | null> {
	const dayStart = new Date(params.startsAt);
	dayStart.setHours(0, 0, 0, 0);
	const dayEnd = new Date(dayStart);
	dayEnd.setDate(dayEnd.getDate() + 1);

	// First significant word of the title, which is what actually collides:
	// "Paper Wolves at the Whiteside" vs "Paper Wolves // Whiteside".
	const stem = params.title.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
	if (stem.length < 3) return null;

	const rows = await db
		.select({ id: event.id, title: event.title, startsAt: event.startsAt })
		.from(event)
		.where(
			and(
				eq(event.status, 'published'),
				gte(event.startsAt, dayStart),
				like(event.title, `%${stem}%`)
			)
		)
		.limit(5);

	const match = rows.find((r) => r.startsAt < dayEnd && r.id !== params.excludeEventId);
	return match ?? null;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export interface CreateCommunityEventParams {
	createdByUserId: string;
	title: string;
	description?: string;
	startsAt: Date;
	/** Omit when the member doesn't know — the common case for someone else's show. */
	endsAt?: Date | null;
	doorsAt?: Date | null;
	location?: string;
	tags?: string;
	externalTicketUrl?: string;
	/** Door / off-site price in cents. CMC never sells these. */
	ticketPrice?: number | null;
	/** Other acts on the bill. Credits naming a platform band land `pending`. */
	lineup?: LineupEntry[];
	posterFile?: { buffer: ArrayBuffer; contentType: string };
}

/**
 * Create a listing as a draft.
 *
 * Always a draft, whatever the member's standing — going live is a separate,
 * deliberate step (publishCommunityEvent). No volume check either: drafting is
 * free, and throttling somebody's scratch work would be indefensible.
 */
export async function createCommunityEvent(params: CreateCommunityEventParams): Promise<EventRow> {
	assertTimes(params.startsAt, params.endsAt ?? null, params.doorsAt ?? null);
	assertValidTicketPrice(params.ticketPrice);

	const [row] = await db
		.insert(event)
		.values({
			title: params.title,
			description: params.description ?? null,
			startsAt: params.startsAt,
			endsAt: params.endsAt ?? null,
			doorsAt: params.doorsAt ?? null,
			location: params.location ?? null,
			tags: params.tags ?? null,
			externalTicketUrl: params.externalTicketUrl ?? null,
			ticketPrice: params.ticketPrice ?? null,
			source: 'community',
			status: 'draft',
			createdByUserId: params.createdByUserId
		})
		.returning();

	if (params.lineup?.length) {
		await setEventLineup(row.id, params.lineup);
	}

	if (params.posterFile) {
		row.posterKey = await storePoster(row.id, params.posterFile);
	}

	return row;
}

export interface UpdateCommunityEventParams {
	title?: string;
	description?: string | null;
	startsAt?: Date;
	/** `undefined` leaves it alone; `null` clears a previously-set end time. */
	endsAt?: Date | null;
	doorsAt?: Date | null;
	location?: string | null;
	tags?: string | null;
	externalTicketUrl?: string | null;
	ticketPrice?: number | null;
	lineup?: LineupEntry[];
	posterFile?: { buffer: ArrayBuffer; contentType: string };
}

/**
 * Edit a listing the caller owns.
 *
 * Editing a draft leaves it a draft. Editing a *live* listing is where standing
 * matters: a trusted member's correction goes out immediately, while a
 * review-required member's drops back into the queue — which is also the path a
 * rejected listing takes back to staff after the member fixes it.
 */
export async function updateCommunityEvent(
	eventId: string,
	userId: string,
	params: UpdateCommunityEventParams
): Promise<EventRow> {
	const existing = await requireOwnedListing(eventId, userId);
	if (existing.status === 'cancelled') {
		throw new ListingStatusError('This listing was cancelled and can no longer be edited');
	}

	const startsAt = params.startsAt ?? existing.startsAt;
	const endsAt = params.endsAt !== undefined ? params.endsAt : existing.endsAt;
	const doorsAt = params.doorsAt !== undefined ? params.doorsAt : existing.doorsAt;
	assertTimes(startsAt, endsAt, doorsAt);

	const updates: Record<string, unknown> = { updatedAt: new Date() };
	if (params.title !== undefined) updates.title = params.title;
	if (params.description !== undefined) updates.description = params.description;
	if (params.startsAt !== undefined) updates.startsAt = params.startsAt;
	if (params.endsAt !== undefined) updates.endsAt = params.endsAt;
	if (params.doorsAt !== undefined) updates.doorsAt = params.doorsAt;
	if (params.location !== undefined) updates.location = params.location;
	if (params.tags !== undefined) updates.tags = params.tags;
	if (params.externalTicketUrl !== undefined) {
		updates.externalTicketUrl = params.externalTicketUrl;
	}
	if (params.ticketPrice !== undefined) {
		assertValidTicketPrice(params.ticketPrice);
		updates.ticketPrice = params.ticketPrice;
	}

	// A review-required member's edit to something already public sends it back
	// to the queue; the listing stays up in the meantime, because yanking it for
	// a typo fix would punish the correction.
	let requeued = false;
	if (existing.status === 'published') {
		const standing = await getStanding(userId, 'community_event');
		if (standing.status !== 'none') {
			updates.status = 'pending_review';
			updates.publishedAt = null;
			requeued = true;
		}
	}

	if (params.posterFile) {
		if (existing.posterKey) await deleteObject(existing.posterKey);
		updates.posterKey = await uploadPosterKey(eventId, params.posterFile);
	}

	const [updated] = await db.update(event).set(updates).where(eq(event.id, eventId)).returning();
	// The row was read a moment ago, so this only happens if it vanished in
	// between. Fail as not-found rather than dereferencing undefined.
	if (!updated) throw new ListingNotFoundError();

	if (params.lineup) {
		await setEventLineup(eventId, params.lineup);
	}

	if (requeued) await emitSubmitted(updated, userId);

	return updated;
}

export interface PublishResult {
	status: 'published' | 'pending_review';
}

/**
 * Take a draft (or a fixed-up rejection) live.
 *
 * Where it lands is the only thing a member's standing changes. This is the one
 * path in this file that reaches the public, so it is the only one that carries
 * a rate limit.
 */
export async function publishCommunityEvent(
	eventId: string,
	userId: string
): Promise<PublishResult> {
	const existing = await requireOwnedListing(eventId, userId);
	if (existing.status !== 'draft' && existing.status !== 'rejected') {
		throw new ListingStatusError(`Cannot publish a listing that is ${existing.status}`);
	}

	const allowed = await allowRateLimited(
		`community-publish:${userId}`,
		PUBLISH_RATE_MAX,
		PUBLISH_RATE_WINDOW_SECONDS
	);
	if (!allowed) throw new PublishRateLimitedError();

	const standing = await getStanding(userId, 'community_event');

	if (standing.status !== 'none') {
		// The member has edited since; the previous reason is stale, and leaving it
		// on screen would tell them to fix something they just fixed.
		await db
			.update(event)
			.set({
				status: 'pending_review',
				publishedAt: null,
				reviewNotes: null,
				updatedAt: new Date()
			})
			.where(eq(event.id, eventId));
		await emitSubmitted(existing, userId);
		return { status: 'pending_review' };
	}

	// A rejected listing isn't a draft, and publish() only moves draft ->
	// published, so normalize first. The member has edited it since; this is a
	// fresh attempt, not a re-run of the one staff turned down.
	if (existing.status === 'rejected') {
		await db
			.update(event)
			.set({ status: 'draft', updatedAt: new Date() })
			.where(eq(event.id, eventId));
	}

	await publishEvent(eventId);
	return { status: 'published' };
}

/** Take a live listing back into the member's own hands. */
export async function unpublishCommunityEvent(eventId: string, userId: string): Promise<void> {
	const existing = await requireOwnedListing(eventId, userId);
	if (existing.status !== 'published') {
		throw new ListingStatusError(`Cannot unpublish a listing that is ${existing.status}`);
	}
	await unpublishEvent(eventId);
}

/**
 * Announce that the show isn't happening.
 *
 * A real cancellation, not a delete: the listing stays on the public guide
 * marked cancelled until its date passes, because the people who need to know
 * are exactly the ones who already had the date.
 */
export async function withdrawCommunityEvent(eventId: string, userId: string): Promise<void> {
	const existing = await requireOwnedListing(eventId, userId);
	if (existing.status !== 'published') {
		throw new ListingStatusError('Only a published listing can be cancelled');
	}
	await db
		.update(event)
		.set({ status: 'cancelled', updatedAt: new Date() })
		.where(eq(event.id, eventId));
}

/**
 * Delete a draft outright.
 *
 * A draft was never public and carries no history worth keeping, so there is
 * nothing for a tombstone to preserve. Lineup rows cascade; the poster object
 * does not, so it goes explicitly.
 */
export async function deleteCommunityEventDraft(eventId: string, userId: string): Promise<void> {
	const existing = await requireOwnedListing(eventId, userId);
	if (existing.status !== 'draft' && existing.status !== 'rejected') {
		throw new ListingStatusError(
			'Only a draft can be deleted — cancel a published listing instead'
		);
	}
	if (existing.posterKey) {
		try {
			await deleteObject(existing.posterKey);
		} catch (err) {
			captureException(err, { event: 'community_event.draft_delete_poster', eventId });
		}
	}
	await db.delete(event).where(eq(event.id, eventId));
}

// ---------------------------------------------------------------------------
// Staff review
// ---------------------------------------------------------------------------

export async function approveSubmission(eventId: string, staffId: string): Promise<void> {
	const existing = await getById(eventId);
	if (!existing) throw new ListingNotFoundError();
	if (existing.status !== 'pending_review') {
		throw new ListingStatusError(`This listing is ${existing.status}, not awaiting review`);
	}
	await publishEvent(eventId);
	// A live listing carries no outstanding complaint.
	await db.update(event).set({ reviewNotes: null }).where(eq(event.id, eventId));
	await emitReviewed({
		eventId,
		eventTitle: existing.title,
		submitterUserId: existing.createdByUserId,
		approved: true,
		notes: null
	});
	void staffId;
}

/**
 * Turn a submission down.
 *
 * Notes are required, following rejectHourLog: a member who can't see what was
 * wrong can't fix it, and `rejected` exists precisely so they can.
 */
export async function rejectSubmission(
	eventId: string,
	staffId: string,
	notes: string
): Promise<void> {
	const trimmed = notes?.trim() ?? '';
	if (!trimmed) {
		throw new ListingStatusError('Give the member a reason so they can correct and resubmit');
	}

	const existing = await getById(eventId);
	if (!existing) throw new ListingNotFoundError();
	if (existing.status !== 'pending_review') {
		throw new ListingStatusError(`This listing is ${existing.status}, not awaiting review`);
	}

	await db
		.update(event)
		.set({
			status: 'rejected',
			publishedAt: null,
			reviewNotes: trimmed,
			updatedAt: new Date()
		})
		.where(eq(event.id, eventId));

	await emitReviewed({
		eventId,
		eventTitle: existing.title,
		submitterUserId: existing.createdByUserId,
		approved: false,
		notes: trimmed
	});
	void staffId;
}

/** Published listings by this member — used to guard account purges. */
export async function countPublishedListingsBy(userId: string): Promise<number> {
	const [row] = await db
		.select({ value: count() })
		.from(event)
		.where(
			and(
				eq(event.source, 'community'),
				eq(event.createdByUserId, userId),
				inArray(event.status, ['published', 'cancelled'])
			)
		);
	return row?.value ?? 0;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function requireOwnedListing(eventId: string, userId: string): Promise<EventRow> {
	const existing = await getById(eventId);
	if (!existing || existing.source !== 'community') throw new ListingNotFoundError();
	if (existing.createdByUserId !== userId) throw new NotListingOwnerError();
	return existing;
}

function assertTimes(startsAt: Date, endsAt: Date | null, doorsAt: Date | null): void {
	if (endsAt != null && startsAt >= endsAt) {
		throw new ListingStatusError('The listing must end after it starts');
	}
	if (doorsAt != null && doorsAt > startsAt) {
		throw new ListingStatusError('Doors must open before the show starts');
	}
}

function assertValidTicketPrice(price: number | null | undefined): void {
	if (price == null) return;
	if (!Number.isInteger(price) || price <= 0) {
		throw new ListingStatusError('Ticket price must be a positive amount');
	}
}

async function uploadPosterKey(
	eventId: string,
	file: { buffer: ArrayBuffer; contentType: string }
): Promise<string> {
	const key = mediaKey('events/posters', eventId, file.contentType);
	await uploadFile(file.buffer, key, file.contentType);
	return key;
}

async function storePoster(
	eventId: string,
	file: { buffer: ArrayBuffer; contentType: string }
): Promise<string> {
	const key = await uploadPosterKey(eventId, file);
	await db
		.update(event)
		.set({ posterKey: key, updatedAt: new Date() })
		.where(eq(event.id, eventId));
	return key;
}

/** Fire-and-forget: never block a member's action on notification fan-out. */
async function emitSubmitted(row: EventRow, userId: string): Promise<void> {
	const [submitter] = await db
		.select({ name: user.name })
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);

	const payload = {
		eventId: row.id,
		eventTitle: row.title,
		submitterUserId: userId,
		submitterName: submitter?.name ?? 'A member',
		startsAt: row.startsAt.toISOString()
	};
	Promise.resolve().then(async () => {
		try {
			await domainEvents.emit('community_event.submitted', payload);
		} catch (err) {
			captureException(err, { event: 'community_event.submitted', eventId: row.id });
		}
	});
}

async function emitReviewed(args: {
	eventId: string;
	eventTitle: string;
	submitterUserId: string;
	approved: boolean;
	notes: string | null;
}): Promise<void> {
	const submitter = await loadRecipient(args.submitterUserId);
	if (!submitter) return;

	const payload = { ...args, ...submitter };
	Promise.resolve().then(async () => {
		try {
			await domainEvents.emit('community_event.reviewed', payload);
		} catch (err) {
			captureException(err, { event: 'community_event.reviewed', eventId: args.eventId });
		}
	});
}

/** Listeners stay DB-free, so the name and address travel with the payload. */
async function loadRecipient(
	userId: string
): Promise<{ submitterName: string; submitterEmail: string } | null> {
	const [row] = await db
		.select({ name: user.name, email: user.email })
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);
	if (!row) return null;
	return { submitterName: row.name, submitterEmail: row.email };
}
