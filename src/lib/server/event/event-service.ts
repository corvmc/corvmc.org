import { db, getRowCount } from '$lib/server/db';
import {
	event,
	eventBand,
	eventGroup,
	publicEventStatuses,
	type EventSource,
	type EventBandStatus,
	type LineupEntry
} from '$lib/server/db/schema/event';
import { groupMember } from '$lib/server/db/schema/group';
import { group } from '$lib/server/db/schema/group';
import { directoryEntry } from '$lib/server/db/schema/directory';
import { user } from '$lib/server/db/schema/authentication';
import { reservation } from '$lib/server/db/schema/reservation';
import { ticket } from '$lib/server/db/schema/ticket';
import { eventRsvp } from '$lib/server/db/schema/event-rsvp';
import { contentFlag } from '$lib/server/db/schema/flag';
import {
	eq,
	and,
	gt,
	gte,
	lt,
	lte,
	ne,
	asc,
	desc,
	inArray,
	not,
	or,
	count,
	getTableColumns
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { paginate, type PaginationInput } from '$lib/server/db/paginate';
import { memberRefColumns } from '$lib/server/entity/refs';
import type { EventStatus } from '$lib/server/db/schema/event';
import { staffCreate } from '$lib/server/reservation/reservation-service';
import { cancel as cancelReservation } from '$lib/server/reservation/reservation-service';
import { hasConflict } from '$lib/server/reservation/conflict-service';
import { captureException } from '$lib/server/sentry';
import { uploadFile, copyObject } from '$lib/server/storage';
import { detachSlot, findByKey, replaceSlot } from '$lib/server/media/media-service';
import { mediaKey } from '$lib/server/storage-keys';
import { ReservationConflictError } from '$lib/server/reservation/reservation-service';
import { domainEvents } from '$lib/server/event-bus/event-bus';
import {
	formatDateFull,
	formatDateInTz,
	buildDateInTz,
	nextDay
} from '$lib/server/reservation/timezone';
import { DEFAULT_TIMEZONE } from '$lib/config';

// ---------------------------------------------------------------------------
// EventService — create, update, publish, cancel events
// ---------------------------------------------------------------------------

export type { EventStatus } from '$lib/server/db/schema/event';

/**
 * The managing group's own `event_group` row.
 *
 * Every write that sets `event.groupId` owes one, exactly as every write that
 * sets it owes a confirmed `event_band` credit. The point is that read paths can
 * assume it: the spec has `event_group` list "whose page does this appear on",
 * and a managing group missing from its own event's list would make every such
 * read branch on "sometimes present, sometimes not".
 *
 * `onConflictDoNothing` because the pair is uniquely indexed and a re-link is
 * not an error — re-importing a gig, or a co-host that is already the owner.
 *
 * Chunked at 20: D1 caps a statement at 100 bound params and a row binds four.
 */
export async function linkManagingGroup(
	links: { eventId: string; groupId: string }[]
): Promise<void> {
	for (let i = 0; i < links.length; i += 20) {
		await db
			.insert(eventGroup)
			.values(links.slice(i, i + 20).map((l) => ({ ...l, sortOrder: 0 })))
			.onConflictDoNothing();
	}
}

export interface EventRow {
	id: string;
	title: string;
	description: string | null;
	startsAt: Date;
	/** Null when unknown — see the column comment on `event.endsAt`. */
	endsAt: Date | null;
	doorsAt: Date | null;
	status: string;
	publishedAt: Date | null;
	reservationId: string | null;
	posterKey: string | null;
	tags: string | null;
	ticketingEnabled: boolean;
	ticketPrice: number | null;
	ticketQuantity: number | null;
	groupId: string | null;
	source: string;
	location: string | null;
	externalTicketUrl: string | null;
	/** Staff's reason for turning down or pulling a community listing. */
	reviewNotes: string | null;
	createdByUserId: string;
	createdAt: Date;
	updatedAt: Date;
}

// ---------------------------------------------------------------------------
// create()
// ---------------------------------------------------------------------------

export interface CreateEventParams {
	title: string;
	description?: string;
	startsAt: Date;
	endsAt: Date;
	doorsAt?: Date;
	tags?: string;
	ticketingEnabled?: boolean;
	ticketPrice?: number | null;
	ticketQuantity?: number | null;
	createdByUserId: string;
	reservation?: {
		startsAt: Date;
		endsAt: Date;
		overrideConflicts: boolean;
	};
	posterFile?: {
		buffer: ArrayBuffer;
		contentType: string;
	};
}

export async function create(params: CreateEventParams): Promise<EventRow> {
	const {
		title,
		description,
		startsAt,
		endsAt,
		doorsAt,
		tags,
		ticketingEnabled = false,
		ticketPrice,
		ticketQuantity,
		createdByUserId,
		reservation: reservationParams,
		posterFile
	} = params;

	if (startsAt >= endsAt) throw new Error('Event must end after it starts');
	if (doorsAt && doorsAt > startsAt) throw new Error('Doors must open before event starts');

	// Validate ticketing fields. The price is what an attendee pays wherever they
	// buy — our checkout, an off-site seller, or the door — so it stands on its
	// own; only selling through us makes it mandatory.
	if (ticketingEnabled && (ticketPrice == null || ticketPrice <= 0)) {
		throw new Error('Ticket price is required when ticketing is enabled');
	}
	assertValidTicketPrice(ticketPrice);

	// D1 has no interactive transactions, so we order the writes so the event row
	// is never persisted in a half-linked state: check conflicts, create the
	// reservation first, then insert the event with the link already set. If the
	// event insert fails, compensate by deleting the just-created reservation.
	const eventId = crypto.randomUUID();

	let reservationId: string | null = null;
	if (reservationParams) {
		if (!reservationParams.overrideConflicts) {
			const conflict = await hasConflict(reservationParams.startsAt, reservationParams.endsAt);
			if (conflict) {
				throw new ReservationConflictError();
			}
		}

		const res = await staffCreate({
			userId: createdByUserId,
			bookerType: 'event',
			bookerId: eventId,
			startsAt: reservationParams.startsAt,
			endsAt: reservationParams.endsAt,
			status: 'confirmed'
		});
		reservationId = res.id;
	}

	let row: EventRow;
	try {
		[row] = await db
			.insert(event)
			.values({
				id: eventId,
				title,
				description: description ?? null,
				startsAt,
				endsAt,
				doorsAt: doorsAt ?? null,
				tags: tags ?? null,
				ticketingEnabled,
				ticketPrice: ticketPrice ?? null,
				// Capacity is only meaningful while we're the ones counting.
				ticketQuantity: ticketingEnabled ? (ticketQuantity ?? null) : null,
				reservationId,
				createdByUserId
			})
			.returning();
	} catch (err) {
		// Compensating write: the event never persisted, so remove the orphan
		// reservation we created for it.
		if (reservationId) {
			try {
				await db.delete(reservation).where(eq(reservation.id, reservationId));
			} catch (cleanupErr) {
				captureException(cleanupErr, { event: 'event.create.compensate', reservationId });
			}
		}
		throw err;
	}

	// Upload poster outside the transaction (non-critical, idempotent)
	if (posterFile) {
		const key = await writeEventPoster(row.id, posterFile);
		await db
			.update(event)
			.set({ posterKey: key, updatedAt: new Date() })
			.where(eq(event.id, row.id));
		row.posterKey = key;
	}

	return row;
}

// ---------------------------------------------------------------------------
// update()
// ---------------------------------------------------------------------------

export interface UpdateEventParams {
	title?: string;
	description?: string | null;
	startsAt?: Date;
	endsAt?: Date;
	doorsAt?: Date | null;
	tags?: string | null;
	location?: string | null;
	externalTicketUrl?: string | null;
	ticketingEnabled?: boolean;
	ticketPrice?: number | null;
	ticketQuantity?: number | null;
	posterFile?: {
		buffer: ArrayBuffer;
		contentType: string;
	};
	/** When times change and a linked reservation exists, rebook it. */
	rebook?: {
		userId: string;
		reservationStartsAt: Date;
		reservationEndsAt: Date;
		overrideConflicts: boolean;
	};
}

/**
 * Check whether an event's time change would require rebooking its reservation.
 * Returns null if no rebook is needed, or an object describing the situation.
 */
export async function checkRebookNeeded(
	eventId: string,
	newStartsAt: Date,
	newEndsAt: Date
): Promise<{
	needed: boolean;
	currentReservation: { id: string; startsAt: Date; endsAt: Date } | null;
	reason: string | null;
}> {
	const evt = await getById(eventId);
	if (!evt) throw new Error('Event not found');

	if (!evt.reservationId) {
		return { needed: false, currentReservation: null, reason: null };
	}

	const [res] = await db
		.select({ id: reservation.id, startsAt: reservation.startsAt, endsAt: reservation.endsAt })
		.from(reservation)
		.where(eq(reservation.id, evt.reservationId))
		.limit(1);

	if (!res) {
		return { needed: false, currentReservation: null, reason: null };
	}

	const currentRes = { id: res.id, startsAt: res.startsAt, endsAt: res.endsAt };

	// Rebook needed if new event times extend outside the current reservation window
	const extendsEarlier = newStartsAt.getTime() < res.startsAt.getTime();
	const extendsLater = newEndsAt.getTime() > res.endsAt.getTime();

	if (!extendsEarlier && !extendsLater) {
		return { needed: false, currentReservation: currentRes, reason: null };
	}

	const reasons: string[] = [];
	if (extendsEarlier) reasons.push('starts earlier than the current reservation');
	if (extendsLater) reasons.push('ends later than the current reservation');

	return {
		needed: true,
		currentReservation: currentRes,
		reason: `New event time ${reasons.join(' and ')}`
	};
}

/**
 * Reject a backwards range on update, against the times the row will end up
 * with — the same guard create() applies. Without it the range reaches D1 as a
 * raw `event_time_order` CHECK-constraint failure (a 500 with no explanation).
 */
function assertTimeOrder(
	existing: { startsAt: Date; endsAt: Date | null },
	params: { startsAt?: Date; endsAt?: Date | null }
): void {
	const startsAt = params.startsAt ?? existing.startsAt;
	const endsAt = params.endsAt !== undefined ? params.endsAt : existing.endsAt;
	// An open-ended gig has nothing to order against — a band backfilling old
	// shows usually can't say when the night finished.
	if (endsAt == null) return;
	if (startsAt >= endsAt) throw new Error('Event must end after it starts');
}

/** A stored ticket price is either null (no price) or a positive whole-cent integer. */
function assertValidTicketPrice(price: number | null | undefined): void {
	if (price == null) return;
	if (!Number.isInteger(price) || price <= 0) {
		throw new Error('Ticket price must be a positive amount');
	}
}

export async function update(eventId: string, params: UpdateEventParams): Promise<EventRow> {
	const existing = await getById(eventId);
	if (!existing) throw new Error('Event not found');
	if (existing.status === 'cancelled') throw new Error('Cannot update a cancelled event');
	assertTimeOrder(existing, params);

	const updates: Record<string, unknown> = { updatedAt: new Date() };
	if (params.title !== undefined) updates.title = params.title;
	if (params.description !== undefined) updates.description = params.description;
	if (params.startsAt !== undefined) updates.startsAt = params.startsAt;
	if (params.endsAt !== undefined) updates.endsAt = params.endsAt;
	if (params.doorsAt !== undefined) updates.doorsAt = params.doorsAt;
	if (params.tags !== undefined) updates.tags = params.tags;
	if (params.location !== undefined) updates.location = params.location;
	if (params.externalTicketUrl !== undefined) {
		updates.externalTicketUrl = params.externalTicketUrl;
	}

	// A band gig is never sold through *our* checkout. The money would land in
	// CMC's Stripe account with no payout path back to the band, so the rule is
	// absolute rather than a band-vs-staff permission: `createBandEvent` cannot
	// set `ticketingEnabled`, and this is the only other writer that can.
	//
	// Scoped to `ticketingEnabled` alone. A band gig legitimately carries a
	// `ticketPrice` — it is a display price for the door or an outside seller,
	// and the band event forms let bands set one — and `externalTicketUrl` is
	// how a band sells at all. Only the platform-checkout flag is off limits.
	// CMC never sells a show it doesn't produce — the money would land in CMC's
	// Stripe account with no payout path back to whoever is actually putting it
	// on. Applies to band gigs and community listings alike.
	if (existing.source !== 'cmc' && params.ticketingEnabled === true) {
		throw new Error('CMC only sells tickets for its own events');
	}

	// Ticketing fields. The price survives whatever happens to the ticketing
	// toggle — switching our checkout off doesn't make the show free, it just
	// means somebody else (or the door) takes the money. Capacity does not: it's
	// only enforceable while we're selling.
	if (params.ticketPrice !== undefined) {
		assertValidTicketPrice(params.ticketPrice);
		updates.ticketPrice = params.ticketPrice;
	}

	if (params.ticketingEnabled !== undefined) {
		updates.ticketingEnabled = params.ticketingEnabled;
		if (params.ticketingEnabled) {
			const price = params.ticketPrice === undefined ? existing.ticketPrice : params.ticketPrice;
			if (price == null) {
				throw new Error('Ticket price is required when ticketing is enabled');
			}
			updates.ticketQuantity = params.ticketQuantity ?? null;
		} else {
			updates.ticketQuantity = null;
		}
	} else if (params.ticketQuantity !== undefined) {
		updates.ticketQuantity = params.ticketQuantity;
	}

	// Hold the space, or move an existing hold. Both live here because they differ
	// only by whether there is an old reservation to release first: an event that
	// was created without space is otherwise unfixable, since nothing else in the
	// app can attach one after the fact.
	if (params.rebook) {
		const { userId, reservationStartsAt, reservationEndsAt, overrideConflicts } = params.rebook;

		// Conflict check first. Cancelling ahead of it meant a rejected window left
		// the event pointing at a reservation we had already released, with nothing
		// re-created and no compensating write — the room lost and the link dead.
		// Excluding the current reservation keeps an event from conflicting with
		// its own hold.
		if (!overrideConflicts) {
			const conflict = await hasConflict(
				reservationStartsAt,
				reservationEndsAt,
				existing.reservationId ?? undefined
			);
			if (conflict) {
				throw new ReservationConflictError();
			}
		}

		if (existing.reservationId) {
			try {
				await cancelReservation(existing.reservationId, userId, 'Event times changed — rebooking', {
					staffOverride: true
				});
			} catch {
				// Already cancelled — continue
			}
		}

		const newRes = await staffCreate({
			userId,
			bookerType: 'event',
			bookerId: eventId,
			startsAt: reservationStartsAt,
			endsAt: reservationEndsAt,
			// Event space is staff-held for drafts too: there is no member confirm/pay
			// flow for it and publish() never touches the reservation, so a
			// `scheduled` hold could only ever be swept away as unconfirmed.
			status: 'confirmed'
		});

		updates.reservationId = newRes.id;
	}

	// Handle poster replacement
	if (params.posterFile) {
		updates.posterKey = await writeEventPoster(eventId, params.posterFile);
	}

	const [updated] = await db.update(event).set(updates).where(eq(event.id, eventId)).returning();

	return updated;
}

// ---------------------------------------------------------------------------
// publish()
// ---------------------------------------------------------------------------

/**
 * Take an event live.
 *
 * Accepts `pending_review` as well as `draft`: staff approving a community
 * listing is the same transition as an owner publishing their own draft, and
 * splitting it into two functions would mean two places to get the
 * publishedAt/status pair right.
 */
export async function publish(eventId: string): Promise<void> {
	const result = await db
		.update(event)
		.set({ status: 'published', publishedAt: new Date(), updatedAt: new Date() })
		.where(and(eq(event.id, eventId), inArray(event.status, ['draft', 'pending_review'])));

	if (getRowCount(result) === 0) {
		const existing = await getById(eventId);
		if (!existing) throw new Error('Event not found');
		throw new Error(`Cannot publish an event with status "${existing.status}"`);
	}
}

// ---------------------------------------------------------------------------
// unpublish()
// ---------------------------------------------------------------------------

export async function unpublish(eventId: string): Promise<void> {
	const existing = await getById(eventId);
	if (!existing) throw new Error('Event not found');
	if (existing.status !== 'published') {
		throw new Error(`Cannot unpublish an event with status "${existing.status}"`);
	}

	const { getTicketsSold } = await import('$lib/server/ticket/ticket-service');
	const sold = await getTicketsSold(eventId);
	if (sold > 0) {
		throw new Error(`Cannot unpublish: ${sold} ticket(s) have been sold`);
	}

	await db
		.update(event)
		.set({ status: 'draft', publishedAt: null, updatedAt: new Date() })
		.where(and(eq(event.id, eventId), eq(event.status, 'published')));
}

/**
 * Unpublish and tell whoever owns the listing, so they can fix it and republish.
 * Pulling someone's gig without a word is the one thing staff must not be able
 * to do by accident, so both entry points — the moderation queue and the staff
 * event page — go through here.
 *
 * No-ops when the event is already off the guide, which is what makes it safe
 * to call from the flag queue after another staff member got there first.
 */
export async function unpublishWithNotice(
	eventId: string,
	opts: { notes?: string } = {}
): Promise<void> {
	const [row] = await db
		.select({
			id: event.id,
			title: event.title,
			status: event.status,
			source: event.source,
			groupId: event.groupId,
			posterKey: event.posterKey,
			createdByUserId: event.createdByUserId,
			bandName: group.name
		})
		.from(event)
		.leftJoin(group, eq(group.id, event.groupId))
		.where(eq(event.id, eventId))
		.limit(1);

	if (!row || row.status !== 'published') return;

	await unpublish(eventId);

	if (row.source === 'community') {
		// Take the poster off its public URL with the listing. The object is served
		// straight from R2 and that URL consults nothing — not status, not source —
		// so leaving the key in place would mean "unpublish" removed the row from
		// the guide while the image stayed readable to anyone holding the link.
		// This path is the kill switch and an image is the riskiest thing on the
		// page, so the link has to stop working.
		//
		// This used to delete the object outright, which achieved that and created
		// a worse problem: a takedown is a moderation decision about whether
		// something should be public, not a licence to destroy the member's
		// artwork. Restoring a listing could never restore its poster, and an
		// unpublish done in error was unrecoverable.
		//
		// So rotate the key instead. The old URL stops resolving — which is the
		// property that matters, since anyone who saw the listing may have the link
		// — while the bytes survive, and republishing brings the poster back with
		// the listing.
		//
		// Note this is no longer about *guessability*: `mediaKey` gives every
		// upload its own random token, so the key was never derivable from the
		// event id to begin with. What rotation buys is invalidating links already
		// handed out, which a random-on-upload key does nothing about.
		let nextPosterKey: string | null = null;
		if (row.posterKey) {
			try {
				// Not `mediaKey`: that builds a key from a content type, and here we
				// only have the existing key. Carrying its extension across is both
				// simpler and more faithful than re-deriving one.
				const ext = row.posterKey.split('.').pop() ?? 'jpg';
				const withheldKey = `events/posters/withheld/${eventId}-${crypto.randomUUID()}.${ext}`;
				// copyObject returns null when the source is already gone, in which
				// case there is nothing to preserve and nothing to delete.
				const moved = await copyObject(row.posterKey, withheldKey);
				if (moved) {
					// The original is detached, not deleted. Deleting it inline is the
					// one thing this module may not do — the write path cannot tell
					// whether another event still points at that object — so the sweep
					// reclaims it instead.
					//
					// That is a real change to this control's timing, and worth naming:
					// a link handed out for the old key stays live until the next daily
					// sweep rather than dying with the takedown. The row is already
					// past the grace window (its `createdAt` is the upload's), so it
					// goes on the first pass, not a day after that.
					// The copy is byte-identical, so it inherits the original's
					// recorded size and type rather than inventing them — a fabricated
					// byteSize is the one thing the backfill refuses to write, and the
					// sweep treats a zero as a broken row.
					const original = await findByKey(row.posterKey);
					await replaceSlot({
						attachableType: 'event',
						attachableId: eventId,
						slot: 'poster',
						key: withheldKey,
						contentType: original?.contentType ?? `image/${ext === 'jpg' ? 'jpeg' : ext}`,
						byteSize: original?.byteSize ?? 0
					});
					nextPosterKey = moved;
				}
			} catch (err) {
				captureException(err, { event: 'community_event.poster_withhold', eventId });
			}
		}

		// Keep the staff note on the row, not just in the email — the member lands
		// on the manage page to fix the listing, and that is where the reason
		// needs to be.
		//
		// Only written when one was given. Unconditionally setting it meant a
		// takedown with no note erased whatever reason was already there, so a
		// member could lose the explanation of an earlier decision to an unrelated
		// later one.
		await db
			.update(event)
			.set({
				posterKey: nextPosterKey,
				...(opts.notes ? { reviewNotes: opts.notes } : {}),
				updatedAt: new Date()
			})
			.where(eq(event.id, eventId));

		const [submitter] = await db
			.select({ name: user.name, email: user.email })
			.from(user)
			.where(eq(user.id, row.createdByUserId))
			.limit(1);
		if (!submitter) return;

		const payload = {
			eventId: row.id,
			eventTitle: row.title,
			submitterUserId: row.createdByUserId,
			submitterName: submitter.name,
			submitterEmail: submitter.email,
			notes: opts.notes || null
		};
		Promise.resolve().then(async () => {
			try {
				await domainEvents.emit('community_event.unpublished', payload);
			} catch (err) {
				captureException(err, { event: 'community_event.unpublished', eventId });
			}
		});
		return;
	}

	// CMC and band unpublish are reversible staff/band workflows — destroying
	// the artwork there would be wrong.
	if (row.source !== 'band' || !row.groupId || !row.bandName) return;

	// Everyone on the bill loses the date, not just the band that booked it, so
	// notify every confirmed act. `bandId`/`bandName` in the payload stay the
	// owner's, which is what the listeners and email template already expect.
	// Through the entry, so an external act on the bill contributes nobody —
	// it has no CMC account, and there is no admin to email.
	const onBill = await db
		.select({ bandId: directoryEntry.groupId })
		.from(eventBand)
		.innerJoin(directoryEntry, eq(directoryEntry.id, eventBand.directoryEntryId))
		.where(and(eq(eventBand.eventId, eventId), eq(eventBand.status, 'confirmed')));
	const notifyBandIds = [
		...new Set([row.groupId, ...onBill.map((r) => r.bandId).filter((id): id is string => !!id)])
	];

	const admins = await db
		.select({ id: user.id, name: user.name, email: user.email })
		.from(groupMember)
		.innerJoin(user, eq(user.id, groupMember.userId))
		.where(
			and(
				inArray(groupMember.groupId, notifyBandIds),
				inArray(groupMember.role, ['owner', 'admin']),
				eq(groupMember.status, 'active')
			)
		);

	const payload = {
		eventId: row.id,
		eventTitle: row.title,
		bandId: row.groupId,
		bandName: row.bandName,
		notes: opts.notes || null,
		bandAdmins: admins.map((u) => ({ userId: u.id, userName: u.name, userEmail: u.email }))
	};

	// Fire-and-forget: don't block the staff action on notification fan-out.
	Promise.resolve().then(async () => {
		try {
			await domainEvents.emit('event.unpublished_by_staff', payload);
		} catch (err) {
			captureException(err, { event: 'event.unpublished_by_staff', eventId });
		}
	});
}

// ---------------------------------------------------------------------------
// remove()
// ---------------------------------------------------------------------------

/** What a delete would destroy, so staff can see it before confirming. */
export interface EventDeletionImpact {
	ticketCount: number;
	rsvpCount: number;
	lineupCount: number;
	hasReservation: boolean;
	/** False when tickets exist — cancel is the end state for those. */
	deletable: boolean;
}

export async function getDeletionImpact(eventId: string): Promise<EventDeletionImpact> {
	const [[tickets], [rsvps], [lineup], existing] = await Promise.all([
		db.select({ value: count() }).from(ticket).where(eq(ticket.eventId, eventId)),
		db.select({ value: count() }).from(eventRsvp).where(eq(eventRsvp.eventId, eventId)),
		db.select({ value: count() }).from(eventBand).where(eq(eventBand.eventId, eventId)),
		getById(eventId)
	]);

	const ticketCount = tickets?.value ?? 0;
	return {
		ticketCount,
		rsvpCount: rsvps?.value ?? 0,
		lineupCount: lineup?.value ?? 0,
		hasReservation: !!existing?.reservationId,
		deletable: ticketCount === 0
	};
}

/**
 * Delete an event outright.
 *
 * This is for a row that should never have existed — a test event, a duplicate,
 * a spam listing. It is NOT a lifecycle transition: a show that is no longer
 * happening gets `cancel()`, which announces it to the people who were coming.
 *
 * Refused once any ticket exists, in any status. Cancelling voids tickets and
 * emails their holders, but the rows themselves are payment and check-in
 * records, so cancel is the *end state* for a ticketed event rather than a step
 * on the way here. `ticket.eventId` cascades, so without this guard a delete
 * would silently take that history with it.
 *
 * Four things need doing by hand, because the FKs alone get them wrong:
 *
 *   - The linked reservation is *cancelled*, not deleted. Deleted, the room
 *     would stay booked (event.reservationId has no onDelete rule, so the row
 *     would simply orphan) — and for a recurring instance the generation job,
 *     which dedupes on reservation rows rather than events, would quietly
 *     recreate the event on its next run.
 *   - The poster is removed from R2. Nothing about that object's URL consults
 *     the database, so leaving it behind means a deleted event's artwork stays
 *     world-readable.
 *   - `content_flag` rows are polymorphic with no FK, so any report against
 *     this event would survive pointing at nothing and break the triage queue.
 *   - `event_band` and `event_rsvp` cascade, which is right: the bill and the
 *     headcount describe an event that, after this, never happened.
 */
export async function remove(eventId: string, userId: string): Promise<void> {
	const existing = await getById(eventId);
	if (!existing) throw new Error('Event not found');

	const [tickets] = await db
		.select({ value: count() })
		.from(ticket)
		.where(eq(ticket.eventId, eventId));

	if ((tickets?.value ?? 0) > 0) {
		throw new Error(
			'This event has tickets and cannot be deleted. Cancel it instead — that voids the tickets and tells the people holding them.'
		);
	}

	if (existing.reservationId) {
		try {
			await cancelReservation(existing.reservationId, userId, 'Event deleted', {
				staffOverride: true
			});
		} catch {
			// Already cancelled, or gone — either way the room is free.
		}
	}

	// Detach, not delete. A recurring series' occurrences share one poster
	// object, so removing one occurrence must not take the others' image with it.
	await detachSlot('event', eventId, 'poster');

	await db
		.delete(contentFlag)
		.where(and(eq(contentFlag.entityType, 'event'), eq(contentFlag.entityId, eventId)));

	await db.delete(event).where(eq(event.id, eventId));
}

// ---------------------------------------------------------------------------
// cancel()
// ---------------------------------------------------------------------------

export async function cancel(eventId: string, userId: string): Promise<void> {
	const existing = await getById(eventId);
	if (!existing) throw new Error('Event not found');
	if (existing.status === 'cancelled') throw new Error('Event is already cancelled');

	const result = await db
		.update(event)
		.set({ status: 'cancelled', updatedAt: new Date() })
		.where(and(eq(event.id, eventId), ne(event.status, 'cancelled')));

	if (getRowCount(result) === 0) throw new Error('Event status changed concurrently');

	// Cancel linked reservation if present
	if (existing.reservationId) {
		try {
			await cancelReservation(existing.reservationId, userId, 'Event cancelled', {
				staffOverride: true
			});
		} catch {
			// Reservation may already be cancelled — ignore
		}
	}

	await detachSlot('event', eventId, 'poster');

	// Capture ticket holders before voiding their tickets (the query below
	// filters on live statuses), then mark the tickets cancelled so they can't
	// be checked in against a cancelled event. Checked-in tickets are left as-is.
	const tickets = await db
		.select({
			attendeeName: ticket.attendeeName,
			attendeeEmail: ticket.attendeeEmail,
			userId: ticket.userId
		})
		.from(ticket)
		.where(and(eq(ticket.eventId, eventId), inArray(ticket.status, ['valid', 'pending'])))
		.limit(5000);

	await db
		.update(ticket)
		.set({ status: 'cancelled', updatedAt: new Date() })
		.where(and(eq(ticket.eventId, eventId), inArray(ticket.status, ['valid', 'pending'])));

	// Emit domain event for every cancellation (fire-and-forget). This fires
	// even when no tickets were sold — the event is the signal that a show was
	// cancelled, not just a notification trigger, and cancelling before any
	// tickets move is the common case. Listeners that only notify holders
	// iterate `ticketHolders` and do nothing when it's empty.
	Promise.resolve().then(async () => {
		try {
			// Deduplicate by email (one notification per buyer)
			const seen = new Set<string>();
			const holders = tickets.filter((t) => {
				if (seen.has(t.attendeeEmail)) return false;
				seen.add(t.attendeeEmail);
				return true;
			});

			await domainEvents.emit('event.cancelled', {
				eventId,
				eventTitle: existing.title,
				eventDate: formatDateFull(existing.startsAt, DEFAULT_TIMEZONE),
				ticketHolders: holders.map((h) => ({
					attendeeName: h.attendeeName,
					attendeeEmail: h.attendeeEmail,
					userId: h.userId ?? undefined
				})),
				// Refunds are handled manually by staff — do not promise automatic
				// processing (no auto-refund flow exists; see tickets-spec deferred).
				refundNote:
					'If you purchased tickets, CMC staff will reach out about your refund. Questions? Reply to this email.'
			});
		} catch (err) {
			captureException(err, { event: 'event.cancelled', eventId });
		}
	});
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function getById(eventId: string): Promise<EventRow | null> {
	const [row] = await db.select().from(event).where(eq(event.id, eventId)).limit(1);

	return row ?? null;
}

/** Published CMC events with startsAt in the future, ordered by date. */
export async function listUpcoming(limit?: number): Promise<EventRow[]> {
	const query = db
		.select()
		.from(event)
		.where(
			and(eq(event.status, 'published'), eq(event.source, 'cmc'), gt(event.startsAt, new Date()))
		)
		.orderBy(asc(event.startsAt));

	if (limit) return query.limit(limit);
	return query;
}

/** Soonest published CMC show on today's calendar day (PT) that hasn't ended yet. */
export async function getShowTonight(now = new Date()): Promise<EventRow | null> {
	const today = formatDateInTz(now, DEFAULT_TIMEZONE);
	const dayStart = buildDateInTz(today, '00:00', DEFAULT_TIMEZONE);
	const dayEnd = buildDateInTz(nextDay(today), '00:00', DEFAULT_TIMEZONE);

	const [row] = await db
		.select()
		.from(event)
		.where(
			and(
				eq(event.status, 'published'),
				eq(event.source, 'cmc'),
				gte(event.startsAt, dayStart),
				lt(event.startsAt, dayEnd),
				gt(event.endsAt, now)
			)
		)
		.orderBy(asc(event.startsAt))
		.limit(1);

	return row ?? null;
}

/** Published events that have already ended, newest first. */
export async function listPast(limit?: number): Promise<EventRow[]> {
	const query = db
		.select()
		.from(event)
		.where(
			and(eq(event.status, 'published'), eq(event.source, 'cmc'), lte(event.startsAt, new Date()))
		)
		.orderBy(desc(event.startsAt));

	if (limit) return query.limit(limit);
	return query;
}

/**
 * All events for staff, newest first. Band-sourced events sit in the same list
 * as CMC ones, so the band name rides along — without it a band's gig is
 * indistinguishable from a show the space is producing.
 *
 * One thing is held back: a community listing still in `draft`. That is a
 * member's private working copy of something they haven't chosen to show
 * anyone, and a staffer browsing events has no business reading it. Community
 * listings become visible here the moment their author acts — `pending_review`
 * asks staff for something, `published` is already public.
 */
export async function listAll(
	opts: { source?: EventSource; status?: EventStatus } = {},
	pagination: PaginationInput = {}
) {
	const filters = [
		opts.source ? eq(event.source, opts.source) : undefined,
		opts.status ? eq(event.status, opts.status) : undefined,
		not(and(eq(event.source, 'community'), eq(event.status, 'draft'))!)
	].filter(Boolean);
	const where = and(...filters);

	const dataQ = db
		.select({ ...getTableColumns(event), bandName: group.name, bandSlug: group.slug })
		.from(event)
		.leftJoin(group, eq(group.id, event.groupId))
		.where(where)
		.orderBy(desc(event.startsAt))
		.$dynamic();
	const countQ = db.select({ count: count() }).from(event).where(where);
	return paginate(dataQ, countQ, pagination);
}

/**
 * The staff calendar: the public gig guide, plus what is asking to join it.
 *
 * Modelled on `listPublicUpcomingEvents` rather than on `listAll`, because it
 * answers a different question. `listAll` is an admin index — newest first,
 * every status, one source at a time — and it is what `/staff/events` uses to
 * run the shows CMC produces. This is the moderation surface, and moderation
 * asks what the public can see, so it reads forward from today across every
 * source, ordered the way the guide orders it.
 *
 * `pending_review` sits alongside the public statuses here and nowhere else. A
 * listing waiting on staff is not public, but it is asking to be, and it has a
 * date — so it belongs in the day it would land on rather than in a queue
 * beside the calendar. That adjacency is the whole point: it is how a staffer
 * sees that the show they are about to approve is already on the calendar under
 * a different name. `checkForDuplicate` calls that the characteristic failure of
 * a community calendar and names moderation as the only backstop, and until this
 * existed the moderation UI could not see it.
 *
 * `from` floors what is *on* the calendar — published and cancelled — and
 * deliberately does not floor the rows that are merely asking to be. See the
 * filter below.
 *
 * The community-draft exclusion is kept even though `draft` is not a status any
 * caller should pass. The list arrives from the caller; a member's private
 * working copy must not become visible because someone widened a Zod enum later.
 */
export async function listStaffCalendar(
	from: Date,
	opts: { statuses: EventStatus[]; sources?: EventSource[] },
	pagination: PaginationInput = {}
) {
	const filters = [
		// The date floor is about the calendar, not the queue. A listing whose
		// date passes while it waits for staff is still a decision someone owes
		// an answer to, and `countPendingSubmissions` — the sidebar badge —
		// counts it with no date filter at all. Flooring it here too would leave
		// the badge reading 3 above a page showing 2, and the stale row would be
		// unreachable in the only view that can clear it.
		or(not(inArray(event.status, [...publicEventStatuses])), gte(event.startsAt, from)),
		inArray(event.status, opts.statuses),
		opts.sources?.length ? inArray(event.source, opts.sources) : undefined,
		not(and(eq(event.source, 'community'), eq(event.status, 'draft'))!)
	].filter(Boolean);
	const where = and(...filters);

	const dataQ = db
		.select({
			...getTableColumns(event),
			bandName: group.name,
			bandSlug: group.slug,
			// Who posted it. `listAll` needs no such join — every row there is
			// CMC's — but on the calendar the submitter is the first fact a
			// moderator wants. Left, so a deleted account does not take the event
			// off the calendar with it; `toMemberRef` renders the missing side as
			// an unlinked row rather than dropping it.
			submitter: memberRefColumns()
		})
		.from(event)
		.leftJoin(group, eq(group.id, event.groupId))
		.leftJoin(user, eq(user.id, event.createdByUserId))
		.where(where)
		.orderBy(asc(event.startsAt))
		.$dynamic();
	const countQ = db.select({ count: count() }).from(event).where(where);
	return paginate(dataQ, countQ, pagination);
}

/** How far either side of a show counts as "the same slot". */
const NEAR_WINDOW_MINUTES = 120;

/**
 * What else is happening around this show, for the staffer judging it.
 *
 * Duplicate postings are the characteristic failure of a community calendar —
 * `checkForDuplicate` says so, and names moderation as the only backstop. Until
 * this existed the moderation screen had no view of the date at all, so the
 * backstop was a person remembering to go and look.
 *
 * Deliberately not `checkForDuplicate` itself. That one stems on the title's
 * first word, so "The Paper Wolves" matches half the calendar; it filters to
 * `published`, so two *pending* submissions of one gig never see each other;
 * and it returns a single row. It is a good advisory nudge for a member writing
 * a listing, which is what it was built for, and a weak signal for a decision.
 * Showing the window and letting the staffer judge asks less of the heuristic
 * and gives them more.
 *
 * Every source, CMC included: the duplicate most worth catching is a member
 * re-posting one of the collective's own shows, which a listings-only read
 * cannot show.
 */
export async function listEventsNear(
	startsAt: Date,
	opts: { excludeEventId: string; windowMinutes?: number; limit?: number }
): Promise<Array<EventRow & { bandName: string | null; bandSlug: string | null }>> {
	const span = (opts.windowMinutes ?? NEAR_WINDOW_MINUTES) * 60_000;
	const from = new Date(startsAt.getTime() - span);
	const to = new Date(startsAt.getTime() + span);

	const rows = await db
		.select({ event, bandName: group.name, bandSlug: group.slug })
		.from(event)
		.leftJoin(group, eq(group.id, event.groupId))
		.where(
			and(
				gte(event.startsAt, from),
				lte(event.startsAt, to),
				ne(event.id, opts.excludeEventId),
				// `pending_review` belongs here and is the whole point: two members
				// submitting one gig is the case the published-only heuristic could
				// never see.
				inArray(event.status, ['pending_review', 'published', 'cancelled']),
				// A member's private working copy stays private, exactly as in
				// `listAll` and `listStaffCalendar`.
				not(and(eq(event.source, 'community'), eq(event.status, 'draft'))!)
			)
		)
		.orderBy(asc(event.startsAt))
		.limit(opts.limit ?? 10);

	return rows.map((r) => ({ ...r.event, bandName: r.bandName, bandSlug: r.bandSlug }));
}

// ---------------------------------------------------------------------------
// Lineup (the bill)
// ---------------------------------------------------------------------------
//
// Two different things live here and must not be conflated:
//
//   event.groupId — who MANAGES the record. One group. Edits, publishes, cancels.
//   event_band    — who PLAYED. A list of names, each optionally linked to a
//                   platform band.
//
// The asymmetry that follows is deliberate and load-bearing:
//
//   reads scoped to a band's profile  filter to `confirmed`
//   reads scoped to an event          filter not at all
//
// So a band can credit anyone on its own bill (it's their factual statement
// about their own show) without that credit appearing on the named band's
// profile until they agree. See `docs/specs/shipped/event-lineup-spec.md`.

export interface LineupRow {
	id: string;
	name: string;
	/** The CMC band behind this credit, if the entry has one. */
	bandId: string | null;
	bandSlug: string | null;
	/**
	 * Where to send someone for an act with no CMC page — the first link the act
	 * gave. Null when they gave none, and then the name renders as plain text.
	 *
	 * This is the third case in the spec's render table. `bandSlug` covers
	 * "confirmed, entry has an owner"; this covers "confirmed, entry has no
	 * owner"; neither is set for the rest.
	 */
	externalUrl: string | null;
	billingOrder: number;
	status: EventBandStatus;
	note: string | null;
}

const LINEUP_MAX = 12;

/**
 * The `directory_entry` id for each of these groups, in one query.
 *
 * A lineup editor picks a *CMC band*, so the input still names a group; the
 * credit stores the party's entry. Every group has an entry — phase 3a
 * backfilled one per band and `create()` has written one for every group since —
 * so a missing row here means the entry was deleted out from under a live group,
 * which is worth failing loudly on rather than silently writing an unlinked
 * credit for a band the editor explicitly chose.
 */
async function entryIdsForGroups(groupIds: string[]): Promise<Map<string, string>> {
	const unique = [...new Set(groupIds)];
	if (unique.length === 0) return new Map();

	const rows = await db
		.select({ groupId: directoryEntry.groupId, id: directoryEntry.id })
		.from(directoryEntry)
		.where(inArray(directoryEntry.groupId, unique));

	return new Map(rows.filter((r) => r.groupId).map((r) => [r.groupId as string, r.id]));
}

/** One group's entry id, for the single-credit write paths. */
async function entryIdForGroup(groupId: string): Promise<string | null> {
	return (await entryIdsForGroups([groupId])).get(groupId) ?? null;
}

function lineupSelect() {
	return db
		.select({
			id: eventBand.id,
			eventId: eventBand.eventId,
			name: eventBand.name,
			// "Which CMC band is this?" is the entry's group, one join away. Null
			// for an external act, which is the same fact as "there is no CMC page
			// to link to".
			bandId: directoryEntry.groupId,
			bandSlug: group.slug,
			// Where an unowned act's name should point instead. Public attribution
			// links **out**, never in: CMC hosts no page for a party that has no
			// relationship with CMC, and the act already has a presence it chose.
			links: directoryEntry.links,
			billingOrder: eventBand.billingOrder,
			status: eventBand.status,
			note: eventBand.note
		})
		.from(eventBand)
		.leftJoin(directoryEntry, eq(directoryEntry.id, eventBand.directoryEntryId))
		.leftJoin(group, eq(group.id, directoryEntry.groupId));
}

/** The whole bill, every status, ordered. For rendering an event. */
/**
 * The first link an act gave, which is where its name points when it has no CMC
 * page. One helper so the single and batched reads cannot disagree about it.
 */
function toLineupRow(row: Awaited<ReturnType<typeof lineupSelect>>[number]): LineupRow {
	const { eventId: _eventId, links, ...rest } = row;
	return { ...rest, externalUrl: links?.[0]?.url ?? null };
}

export async function getEventLineup(eventId: string): Promise<LineupRow[]> {
	const rows = await lineupSelect()
		.where(eq(eventBand.eventId, eventId))
		.orderBy(asc(eventBand.billingOrder));
	return rows.map(toLineupRow);
}

/** Batched variant — list pages would otherwise fire one query per row. */
export async function getEventLineups(eventIds: string[]): Promise<Map<string, LineupRow[]>> {
	const out = new Map<string, LineupRow[]>();
	if (eventIds.length === 0) return out;

	const rows = await lineupSelect()
		.where(inArray(eventBand.eventId, eventIds))
		.orderBy(asc(eventBand.billingOrder));

	for (const row of rows) {
		const shaped = toLineupRow(row);
		const list = out.get(row.eventId);
		if (list) list.push(shaped);
		else out.set(row.eventId, [shaped]);
	}
	return out;
}

export interface SetLineupOptions {
	/** The band performing the edit. Its own slot is auto-confirmed. */
	actingBandId?: string;
	/** Staff booked the show, so every act they name is already agreed. */
	asStaff?: boolean;
}

/**
 * Replace an event's bill.
 *
 * Status resolution per entry:
 *   no bandId                        -> unlinked  (nobody to ask)
 *   bandId is the acting band/staff  -> confirmed
 *   otherwise                        -> pending, and the band is notified
 *
 * Rows that already exist keep their status, with one hard rule: a `declined`
 * row is never resurrected. Re-adding a band that said no leaves it declined,
 * which is what stops an owner from re-inviting on a loop.
 */
export async function setEventLineup(
	eventId: string,
	entries: LineupEntry[],
	opts: SetLineupOptions = {}
): Promise<void> {
	if (entries.length > LINEUP_MAX) {
		throw new Error(`At most ${LINEUP_MAX} acts on a bill`);
	}

	const evt = await getById(eventId);
	if (!evt) throw new Error('Event not found');

	// Dedupe on band identity first, then on the visible name, so "Paper Wolves"
	// typed twice collapses even when neither entry is linked.
	const seenBands = new Set<string>();
	const seenNames = new Set<string>();
	const deduped: LineupEntry[] = [];
	for (const e of entries) {
		const name = e.name.trim();
		if (!name) continue;
		const nameKey = name.toLowerCase();
		if (e.bandId) {
			if (seenBands.has(e.bandId)) continue;
			seenBands.add(e.bandId);
		} else if (seenNames.has(nameKey)) {
			continue;
		}
		seenNames.add(nameKey);
		deduped.push({ ...e, name });
	}

	const existing = await db.select().from(eventBand).where(eq(eventBand.eventId, eventId));
	const byBand = new Map(existing.filter((r) => r.bandId).map((r) => [r.bandId!, r]));
	const byName = new Map(existing.filter((r) => !r.bandId).map((r) => [r.name.toLowerCase(), r]));

	// The owner's slot is not the owner's to delete.
	const ownerRow = evt.groupId ? byBand.get(evt.groupId) : undefined;
	const hasOwner = deduped.some((e) => e.bandId && e.bandId === evt.groupId);
	if (ownerRow && !hasOwner) {
		deduped.unshift({
			name: ownerRow.name,
			bandId: ownerRow.bandId ?? undefined,
			billingOrder: 0,
			note: ownerRow.note ?? undefined
		});
	}

	// Resolved before the map, in one query, because every linked credit needs
	// its party's entry id and the map is synchronous.
	const entryIds = await entryIdsForGroups(
		deduped.map((e) => e.bandId).filter((id): id is string => !!id)
	);

	const invited: { bandId: string; name: string }[] = [];
	const rows = deduped.map((e, i) => {
		const prior = e.bandId ? byBand.get(e.bandId) : byName.get(e.name.toLowerCase());

		let status: EventBandStatus;
		if (!e.bandId) {
			status = 'unlinked';
		} else if (prior) {
			// Keep whatever the band already decided. Notably: declined stays declined.
			status = prior.status === 'unlinked' ? 'pending' : prior.status;
		} else if (opts.asStaff || e.bandId === opts.actingBandId) {
			status = 'confirmed';
		} else {
			status = 'pending';
		}

		if (status === 'pending' && !prior && e.bandId) {
			invited.push({ bandId: e.bandId, name: e.name });
		}

		return {
			eventId,
			name: e.name,
			// Both, while `bandId` still exists. It is written and read by nothing,
			// so the phase-10 backfill stays recoverable from a column that is still
			// being maintained rather than from one already going stale.
			bandId: e.bandId ?? null,
			directoryEntryId: e.bandId ? (entryIds.get(e.bandId) ?? null) : null,
			billingOrder: i,
			status,
			note: e.note ?? null,
			addedByBandId: opts.actingBandId ?? null
		};
	});

	await db.delete(eventBand).where(eq(eventBand.eventId, eventId));
	if (rows.length) {
		// D1 caps a statement at 100 bound params; ~7 columns per row.
		for (let i = 0; i < rows.length; i += 12) {
			await db.insert(eventBand).values(rows.slice(i, i + 12));
		}
	}

	if (invited.length)
		await notifyLineupInvites(
			evt,
			invited.map((i) => i.bandId)
		);
}

/**
 * Tell each newly-invited band's owners/admins they're on a bill. Resolved here
 * rather than in the listener so notification handlers stay DB-free — the same
 * split `unpublishWithNotice` uses.
 */
async function notifyLineupInvites(
	evt: { id: string; title: string; startsAt: Date; groupId: string | null },
	invitedBandIds: string[]
): Promise<void> {
	const [owner] = evt.groupId
		? await db.select({ name: group.name }).from(group).where(eq(group.id, evt.groupId)).limit(1)
		: [undefined];

	const rows = await db
		.select({
			bandId: group.id,
			bandName: group.name,
			bandSlug: group.slug,
			userId: user.id,
			userName: user.name,
			userEmail: user.email
		})
		.from(groupMember)
		.innerJoin(group, eq(group.id, groupMember.groupId))
		.innerJoin(user, eq(user.id, groupMember.userId))
		.where(
			and(
				inArray(groupMember.groupId, invitedBandIds),
				inArray(groupMember.role, ['owner', 'admin']),
				eq(groupMember.status, 'active')
			)
		);

	const byBand = new Map<string, typeof rows>();
	for (const r of rows) {
		const list = byBand.get(r.bandId);
		if (list) list.push(r);
		else byBand.set(r.bandId, [r]);
	}

	// Fire-and-forget: a slow mail hop must not stall saving the bill.
	Promise.resolve().then(async () => {
		for (const [bandId, admins] of byBand) {
			try {
				await domainEvents.emit('event.lineup_invited', {
					eventId: evt.id,
					eventTitle: evt.title,
					startsAt: evt.startsAt.toISOString(),
					invitedBandId: bandId,
					invitedBandName: admins[0].bandName,
					invitedBandSlug: admins[0].bandSlug,
					ownerBandName: owner?.name ?? null,
					bandAdmins: admins.map((a) => ({
						userId: a.userId,
						userName: a.userName,
						userEmail: a.userEmail
					}))
				});
			} catch (err) {
				captureException(err, { event: 'event.lineup_invited', eventId: evt.id });
			}
		}
	});
}

async function setLineupSlotStatus(
	eventId: string,
	bandId: string,
	status: Extract<EventBandStatus, 'confirmed' | 'declined'>
): Promise<void> {
	await db
		.update(eventBand)
		.set({ status })
		.where(and(eq(eventBand.eventId, eventId), creditBelongsToGroup(bandId)));
}

/** The invited band agrees. Only now does the show reach their profile. */
export async function confirmLineupSlot(eventId: string, bandId: string): Promise<void> {
	await setLineupSlotStatus(eventId, bandId, 'confirmed');
}

/**
 * The invited band says no. The row keeps both its name and its bandId — the
 * name so the owner's bill still reads correctly, the bandId so the partial
 * unique index blocks a re-invite.
 */
export async function declineLineupSlot(eventId: string, bandId: string): Promise<void> {
	await setLineupSlotStatus(eventId, bandId, 'declined');
}

/** Staff: attach a platform band to a name that was typed in free-text. */
export async function linkLineupSlot(eventBandId: string, bandId: string): Promise<void> {
	await db
		.update(eventBand)
		.set({ bandId, status: 'pending' })
		.where(and(eq(eventBand.id, eventBandId), eq(eventBand.status, 'unlinked')));
}

export interface LineupInvite {
	eventId: string;
	eventTitle: string;
	startsAt: Date;
	location: string | null;
	billingOrder: number;
	note: string | null;
	ownerBandName: string | null;
}

/** Bills this band has been named on but hasn't answered yet. */
export async function listBandLineupInvites(bandId: string): Promise<LineupInvite[]> {
	const owner = alias(group, 'owner_band');
	return db
		.select({
			eventId: event.id,
			eventTitle: event.title,
			startsAt: event.startsAt,
			location: event.location,
			billingOrder: eventBand.billingOrder,
			note: eventBand.note,
			ownerBandName: owner.name
		})
		.from(eventBand)
		.innerJoin(event, eq(event.id, eventBand.eventId))
		.leftJoin(owner, eq(owner.id, event.groupId))
		.where(
			and(
				creditBelongsToGroup(bandId),
				eq(eventBand.status, 'pending'),
				ne(event.status, 'cancelled')
			)
		)
		.orderBy(asc(event.startsAt));
}

/**
 * "This credit belongs to this CMC band."
 *
 * After the phase-10 re-key a credit names a `directory_entry`, so the band it
 * belongs to is the entry's group — one level of indirection, expressed once
 * here rather than at each of the four call sites. An external act's entry has
 * no group, so it matches nothing, which is correct: an act with no CMC
 * relationship has no band profile to appear on and no admins to notify.
 */
function creditBelongsToGroup(groupId: string) {
	return inArray(
		eventBand.directoryEntryId,
		db
			.select({ id: directoryEntry.id })
			.from(directoryEntry)
			.where(eq(directoryEntry.groupId, groupId))
	);
}

/**
 * Events a band is publicly credited on: ones it owns, plus ones it confirmed.
 * The subquery is the single definition of "shows on this band's profile".
 */
function confirmedForBand(bandId: string) {
	return inArray(
		event.id,
		db
			.select({ id: eventBand.eventId })
			.from(eventBand)
			.where(and(creditBelongsToGroup(bandId), eq(eventBand.status, 'confirmed')))
	);
}

// ---------------------------------------------------------------------------
// Band Events
// ---------------------------------------------------------------------------

export interface CreateBandEventParams {
	bandId: string;
	createdByUserId: string;
	title: string;
	description?: string;
	startsAt: Date;
	/** Omit when the band doesn't know — common when backfilling old gigs. */
	endsAt?: Date | null;
	doorsAt?: Date;
	location?: string;
	tags?: string;
	externalTicketUrl?: string;
	/** Door / off-site price in cents. Bands never sell through our checkout. */
	ticketPrice?: number | null;
	/** Other acts on the bill. The owner's own slot is written automatically. */
	support?: LineupEntry[];
	posterFile?: {
		buffer: ArrayBuffer;
		contentType: string;
	};
}

export async function createBandEvent(params: CreateBandEventParams): Promise<EventRow> {
	const {
		bandId,
		createdByUserId,
		title,
		description,
		startsAt,
		endsAt,
		doorsAt,
		location,
		tags,
		externalTicketUrl,
		ticketPrice,
		posterFile,
		support
	} = params;

	if (endsAt != null && startsAt >= endsAt) throw new Error('Event must end after it starts');
	if (doorsAt && doorsAt > startsAt) throw new Error('Doors must open before event starts');
	assertValidTicketPrice(ticketPrice);

	const [row] = await db
		.insert(event)
		.values({
			title,
			description: description ?? null,
			startsAt,
			endsAt: endsAt ?? null,
			doorsAt: doorsAt ?? null,
			tags: tags ?? null,
			location: location ?? null,
			externalTicketUrl: externalTicketUrl ?? null,
			ticketPrice: ticketPrice ?? null,
			// The event's owner. The `bandId` on the lineup row below is a different
			// column with a different meaning — a credit, not authority.
			groupId: bandId,
			source: 'band',
			createdByUserId
		})
		.returning();

	await linkManagingGroup([{ eventId: row.id, groupId: bandId }]);

	// Invariant: setting event.groupId always writes the matching confirmed
	// lineup row. The owner heads its own bill until told otherwise.
	const [owner] = await db
		.select({ name: group.name })
		.from(group)
		.where(eq(group.id, bandId))
		.limit(1);
	await db.insert(eventBand).values({
		eventId: row.id,
		name: owner?.name ?? 'Unknown band',
		bandId,
		directoryEntryId: await entryIdForGroup(bandId),
		billingOrder: 0,
		status: 'confirmed',
		addedByBandId: bandId
	});

	if (support?.length) {
		await setEventLineup(
			row.id,
			[{ name: owner?.name ?? '', bandId, billingOrder: 0 }, ...support],
			{
				actingBandId: bandId
			}
		);
	}

	if (posterFile) {
		const key = await writeEventPoster(row.id, posterFile);
		await db
			.update(event)
			.set({ posterKey: key, updatedAt: new Date() })
			.where(eq(event.id, row.id));
		row.posterKey = key;
	}

	return row;
}

/**
 * A group's sessions — everything on its page, in date order.
 *
 * Read through `event_group` rather than `event.groupId`, because that is the
 * question the table answers: "whose page does this appear on." A session the
 * group manages and one it co-hosts both belong here, and the managing group's
 * own row is written automatically, so this needs no union with the owner
 * column.
 */
export async function listGroupSessions(
	groupId: string,
	opts: { upcomingOnly?: boolean } = {}
): Promise<EventRow[]> {
	const conditions = [
		inArray(
			event.id,
			db.select({ id: eventGroup.eventId }).from(eventGroup).where(eq(eventGroup.groupId, groupId))
		)
	];
	if (opts.upcomingOnly) conditions.push(gt(event.startsAt, new Date()));

	return db
		.select()
		.from(event)
		.where(and(...conditions))
		.orderBy(opts.upcomingOnly ? asc(event.startsAt) : desc(event.startsAt))
		.limit(100);
}

export interface CreateGroupEventParams {
	groupId: string;
	createdByUserId: string;
	title: string;
	description?: string;
	startsAt: Date;
	/**
	 * Required, unlike a band gig's. A group session holds the room, and a
	 * reservation with no end has nothing to reserve. The `event_cmc_needs_end`
	 * CHECK does not cover this — widening it would rebuild `event`, which is the
	 * riskiest rebuild in the schema — so the rule lives here instead.
	 */
	endsAt: Date;
	doorsAt?: Date;
	tags?: string;
	/**
	 * Hold the room for the session. Omitted for a program meeting somewhere
	 * else, which is a listing like any other.
	 */
	reservation?: {
		startsAt: Date;
		endsAt: Date;
		overrideConflicts: boolean;
	};
	posterFile?: {
		buffer: ArrayBuffer;
		contentType: string;
	};
}

/**
 * A club's or committee's session — and the first path outside the staff panel
 * that can reserve the room.
 *
 * The three existing creators each get one thing wrong for a program. `create()`
 * reserves the room but is staff-only and produces a CMC event.
 * `createBandEvent()` is member-reachable but reserves nothing — it is an
 * off-site gig listing with a `location`. `createCommunityEvent()` is neither
 * hosted nor managed by CMC. So this is `create()`'s reservation path with
 * `createBandEvent()`'s ownership.
 *
 * **The room is free and the group does not book it.** The reservation belongs
 * to the *event* — `bookerType: 'event'`, `bookerId` the event id — exactly as a
 * staff CMC event's does. Booking as the group would imply the group has a
 * balance to spend, which is precisely what a sanctioned program does not need,
 * and no credit ledger is touched.
 *
 * The write order is `create()`'s, and for the same reason: D1 has no
 * interactive transactions, so the reservation is written first and the event
 * inserted with the link already set, never in a half-linked state. A failed
 * event insert compensates by deleting the reservation it just made.
 */
export async function createGroupEvent(params: CreateGroupEventParams): Promise<EventRow> {
	const {
		groupId,
		createdByUserId,
		title,
		description,
		startsAt,
		endsAt,
		doorsAt,
		tags,
		reservation: reservationParams,
		posterFile
	} = params;

	if (startsAt >= endsAt) throw new Error('Event must end after it starts');
	if (doorsAt && doorsAt > startsAt) throw new Error('Doors must open before event starts');

	const eventId = crypto.randomUUID();

	let reservationId: string | null = null;
	if (reservationParams) {
		if (reservationParams.startsAt >= reservationParams.endsAt) {
			throw new Error('Reservation must end after it starts');
		}
		if (!reservationParams.overrideConflicts) {
			const conflict = await hasConflict(reservationParams.startsAt, reservationParams.endsAt);
			if (conflict) throw new ReservationConflictError();
		}

		const res = await staffCreate({
			userId: createdByUserId,
			// Not `'group'`. The room is held for the session, not booked by the
			// program — see docs/specs/groups-spec.md § Room time.
			bookerType: 'event',
			bookerId: eventId,
			startsAt: reservationParams.startsAt,
			endsAt: reservationParams.endsAt,
			status: 'confirmed'
		});
		reservationId = res.id;
	}

	let row: EventRow;
	try {
		[row] = await db
			.insert(event)
			.values({
				id: eventId,
				title,
				description: description ?? null,
				startsAt,
				endsAt,
				doorsAt: doorsAt ?? null,
				tags: tags ?? null,
				groupId,
				source: 'group',
				reservationId,
				createdByUserId
			})
			.returning();
	} catch (err) {
		// Compensating write: the event never persisted, so remove the orphan
		// reservation made for it.
		if (reservationId) {
			try {
				await db.delete(reservation).where(eq(reservation.id, reservationId));
			} catch (cleanupErr) {
				captureException(cleanupErr, {
					event: 'group_event.create.compensate',
					reservationId
				});
			}
		}
		throw err;
	}

	await linkManagingGroup([{ eventId: row.id, groupId }]);

	// No `event_band` credit, unlike a band event. A club's jam has no bill —
	// nobody's name is on a poster — and writing the group in as its own act
	// would put a club into every "bands who played here" read.

	if (posterFile) {
		const key = await writeEventPoster(row.id, posterFile);
		await db
			.update(event)
			.set({ posterKey: key, updatedAt: new Date() })
			.where(eq(event.id, row.id));
		row.posterKey = key;
	}

	return row;
}

/**
 * Upload a poster and point the event's `poster` slot at it, returning the key
 * for `event.posterKey`.
 *
 * That column stays as the read path — 60-odd queries select it inline — with
 * this as its single writer. What the media tables add underneath is the
 * object's lifetime: the previous poster is *detached*, never deleted here,
 * because a recurring series' occurrences may share one object and only the
 * sweep can see that. See docs/specs/shipped/media-spec.md.
 */
async function writeEventPoster(
	eventId: string,
	posterFile: { buffer: ArrayBuffer; contentType: string }
): Promise<string> {
	const key = mediaKey('events/posters', eventId, posterFile.contentType);
	await uploadFile(posterFile.buffer, key, posterFile.contentType);
	await replaceSlot({
		attachableType: 'event',
		attachableId: eventId,
		slot: 'poster',
		key,
		contentType: posterFile.contentType,
		byteSize: posterFile.buffer.byteLength
	});
	return key;
}

export interface UpdateBandEventParams {
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
	posterFile?: {
		buffer: ArrayBuffer;
		contentType: string;
	};
}

export async function updateBandEvent(
	eventId: string,
	bandId: string,
	params: UpdateBandEventParams
): Promise<EventRow> {
	const existing = await getById(eventId);
	if (!existing) throw new Error('Event not found');
	if (existing.groupId !== bandId) throw new Error('Event does not belong to this band');
	if (existing.status === 'cancelled') throw new Error('Cannot update a cancelled event');
	assertTimeOrder(existing, params);

	const updates: Record<string, unknown> = { updatedAt: new Date() };
	if (params.title !== undefined) updates.title = params.title;
	if (params.description !== undefined) updates.description = params.description;
	if (params.startsAt !== undefined) updates.startsAt = params.startsAt;
	if (params.endsAt !== undefined) updates.endsAt = params.endsAt;
	if (params.doorsAt !== undefined) updates.doorsAt = params.doorsAt;
	if (params.location !== undefined) updates.location = params.location;
	if (params.tags !== undefined) updates.tags = params.tags;
	if (params.externalTicketUrl !== undefined) updates.externalTicketUrl = params.externalTicketUrl;
	if (params.ticketPrice !== undefined) {
		assertValidTicketPrice(params.ticketPrice);
		updates.ticketPrice = params.ticketPrice;
	}

	if (params.posterFile) {
		updates.posterKey = await writeEventPoster(eventId, params.posterFile);
	}

	const [updated] = await db.update(event).set(updates).where(eq(event.id, eventId)).returning();

	return updated;
}

export async function cancelBandEvent(eventId: string, bandId: string): Promise<void> {
	const existing = await getById(eventId);
	if (!existing) throw new Error('Event not found');
	if (existing.groupId !== bandId) throw new Error('Event does not belong to this band');
	if (existing.status === 'cancelled') throw new Error('Event is already cancelled');

	await db
		.update(event)
		.set({ status: 'cancelled', updatedAt: new Date() })
		.where(eq(event.id, eventId));

	await detachSlot('event', eventId, 'poster');
}

/** Remove a gig's poster. Owner-only, like every other edit. */
export async function clearBandEventPoster(eventId: string, bandId: string): Promise<void> {
	const existing = await getById(eventId);
	if (!existing) throw new Error('Event not found');
	if (existing.groupId !== bandId) throw new Error('Event does not belong to this band');
	if (!existing.posterKey) return;

	await detachSlot('event', eventId, 'poster');
	await db
		.update(event)
		.set({ posterKey: null, updatedAt: new Date() })
		.where(eq(event.id, eventId));
}

/** One backfilled gig, already parsed and validated by `parseGigImport`. */
export interface ImportGigRow {
	title: string;
	startsAt: Date;
	location?: string;
	externalTicketUrl?: string;
	/** Free-text support credits. Always unlinked — see `importBandEvents`. */
	support?: string[];
}

const IMPORT_MAX = 100;

/**
 * Bulk-create past gigs for a band.
 *
 * Imported rows are published (they already happened) and carry no end time —
 * that's what the nullable column is for. Support acts land as `unlinked`
 * credits no matter what: a hundred-gig backfill must never fan out a hundred
 * invites, so linking a name to an account stays a deliberate, separate act.
 */
export async function importBandEvents(
	bandId: string,
	createdByUserId: string,
	rows: ImportGigRow[]
): Promise<number> {
	if (rows.length === 0) return 0;
	if (rows.length > IMPORT_MAX) throw new Error(`At most ${IMPORT_MAX} gigs per import`);

	const [owner] = await db
		.select({ name: group.name })
		.from(group)
		.where(eq(group.id, bandId))
		.limit(1);
	if (!owner) throw new Error('Band not found');

	const values = rows.map((r) => ({
		title: r.title,
		startsAt: r.startsAt,
		endsAt: null,
		location: r.location ?? null,
		externalTicketUrl: r.externalTicketUrl ?? null,
		// The owning group. Built through `.map()`, so TypeScript's excess-property
		// check does not apply here — a stale `bandId` key would have passed
		// through silently and drizzle would have dropped it, importing every gig
		// with no owner at all.
		groupId: bandId,
		source: 'band' as const,
		status: 'published' as const,
		publishedAt: new Date(),
		createdByUserId
	}));

	// D1 caps a statement at 100 bound params; ~10 columns per row here.
	const inserted: { id: string }[] = [];
	for (let i = 0; i < values.length; i += 8) {
		const chunk = await db
			.insert(event)
			.values(values.slice(i, i + 8))
			.returning({ id: event.id });
		inserted.push(...chunk);
	}

	await linkManagingGroup(inserted.map((row) => ({ eventId: row.id, groupId: bandId })));

	const ownerEntryId = await entryIdForGroup(bandId);
	const credits = inserted.flatMap((row, i) => [
		{
			eventId: row.id,
			name: owner.name,
			bandId,
			directoryEntryId: ownerEntryId,
			billingOrder: 0,
			status: 'confirmed' as const,
			addedByBandId: bandId
		},
		// Support acts are names only — an imported gig has no way to say which
		// CMC band a support slot was, which is exactly what `unlinked` means.
		...(rows[i].support ?? []).slice(0, 11).map((name, j) => ({
			eventId: row.id,
			name,
			bandId: null,
			directoryEntryId: null,
			billingOrder: j + 1,
			status: 'unlinked' as const,
			addedByBandId: bandId
		}))
	]);

	for (let i = 0; i < credits.length; i += 12) {
		await db.insert(eventBand).values(credits.slice(i, i + 12));
	}

	return inserted.length;
}

/** Published band events with startsAt in the future. */
export async function listBandEventsUpcoming(bandId: string, limit?: number): Promise<EventRow[]> {
	const query = db
		.select()
		.from(event)
		.where(
			and(confirmedForBand(bandId), eq(event.status, 'published'), gt(event.startsAt, new Date()))
		)
		.orderBy(asc(event.startsAt));

	if (limit) return query.limit(limit);
	return query;
}

export interface BandEventRow extends EventRow {
	/** False for shows the band was credited on but doesn't manage. */
	isOwner: boolean;
}

/** All events on a band's bill (all statuses), newest first. */
export async function listBandEvents(bandId: string): Promise<BandEventRow[]> {
	const rows = await db
		.select()
		.from(event)
		.where(confirmedForBand(bandId))
		.orderBy(desc(event.startsAt));
	return rows.map((r) => ({ ...r, isOwner: r.groupId === bandId }));
}

/** Count of a band's published past shows — the legacy / veteran signal. */
export async function countBandPastEvents(bandId: string): Promise<number> {
	const [row] = await db
		.select({ value: count() })
		.from(event)
		.where(
			and(confirmedForBand(bandId), eq(event.status, 'published'), lte(event.startsAt, new Date()))
		);
	return row?.value ?? 0;
}

/**
 * Published band shows already played, newest first. Fetches limit+1 rows so
 * callers can derive hasMore.
 */
export async function listBandEventsPast(
	bandId: string,
	opts: { limit: number; offset: number }
): Promise<EventRow[]> {
	return db
		.select()
		.from(event)
		.where(
			and(confirmedForBand(bandId), eq(event.status, 'published'), lte(event.startsAt, new Date()))
		)
		.orderBy(desc(event.startsAt))
		.limit(opts.limit + 1)
		.offset(opts.offset);
}

export interface MemberShowRow extends EventRow {
	/** The credited band, whose id makes the byline reachable rather than text.
	 *  `null` when the event has no confirmed credit. */
	bandId: string | null;
	bandName: string;
	bandSlug: string;
}

/**
 * Upcoming published shows aggregated across all of a member's *active* bands,
 * each tagged with the band it belongs to. Soonest first.
 */
/**
 * Events any of this member's active bands is confirmed on.
 *
 * Expressed as a subquery rather than a join so one row comes back per event.
 * A member in two bands on the same bill would otherwise be counted twice —
 * and with limit+1 paging, a post-hoc dedupe would make `hasMore` lie.
 */
function confirmedForMember(userId: string) {
	return inArray(
		event.id,
		db
			.select({ id: eventBand.eventId })
			.from(eventBand)
			// The credit names an entry; the entry names the band; the band has
			// members. An external act's entry has no group, so it joins away —
			// which is right, since nobody is a member of an external act.
			.innerJoin(directoryEntry, eq(directoryEntry.id, eventBand.directoryEntryId))
			.innerJoin(
				groupMember,
				and(
					eq(groupMember.groupId, directoryEntry.groupId),
					eq(groupMember.userId, userId),
					eq(groupMember.status, 'active')
				)
			)
			.where(eq(eventBand.status, 'confirmed'))
	);
}

/**
 * Attach the byline band to each event: whichever of the member's own bands is
 * credited on it, taking the highest-billed when there is more than one.
 */
async function withMemberBylines(rows: EventRow[], userId: string): Promise<MemberShowRow[]> {
	if (rows.length === 0) return [];

	const credits = await db
		.select({
			eventId: eventBand.eventId,
			billingOrder: eventBand.billingOrder,
			bandId: directoryEntry.groupId,
			bandName: group.name,
			bandSlug: group.slug
		})
		.from(eventBand)
		.innerJoin(directoryEntry, eq(directoryEntry.id, eventBand.directoryEntryId))
		.innerJoin(group, eq(group.id, directoryEntry.groupId))
		.innerJoin(
			groupMember,
			and(
				eq(groupMember.groupId, directoryEntry.groupId),
				eq(groupMember.userId, userId),
				eq(groupMember.status, 'active')
			)
		)
		.where(
			and(
				inArray(
					eventBand.eventId,
					rows.map((r) => r.id)
				),
				eq(eventBand.status, 'confirmed')
			)
		)
		.orderBy(asc(eventBand.billingOrder));

	const byEvent = new Map<string, { bandId: string | null; bandName: string; bandSlug: string }>();
	for (const c of credits) {
		if (!byEvent.has(c.eventId))
			byEvent.set(c.eventId, { bandId: c.bandId, bandName: c.bandName, bandSlug: c.bandSlug });
	}

	return rows.map((r) => ({
		...r,
		// An event with no confirmed credit keeps its empty byline; `null` for the
		// id rather than '' so a ref built from it renders unlinked instead of
		// pointing at a band that does not exist.
		bandId: byEvent.get(r.id)?.bandId ?? null,
		bandName: byEvent.get(r.id)?.bandName ?? '',
		bandSlug: byEvent.get(r.id)?.bandSlug ?? ''
	}));
}

export async function listMemberUpcomingShows(userId: string): Promise<MemberShowRow[]> {
	const rows = await db
		.select()
		.from(event)
		.where(
			and(confirmedForMember(userId), eq(event.status, 'published'), gt(event.startsAt, new Date()))
		)
		.orderBy(asc(event.startsAt));

	return withMemberBylines(rows, userId);
}

/**
 * Past published shows across a member's active bands, newest first. Fetches
 * limit+1 rows so callers can derive hasMore.
 */
export async function listMemberPastShows(
	userId: string,
	opts: { limit: number; offset: number }
): Promise<MemberShowRow[]> {
	const rows = await db
		.select()
		.from(event)
		.where(
			and(
				confirmedForMember(userId),
				eq(event.status, 'published'),
				lte(event.startsAt, new Date())
			)
		)
		.orderBy(desc(event.startsAt))
		.limit(opts.limit + 1)
		.offset(opts.offset);

	return withMemberBylines(rows, userId);
}

/** Count of past published shows across a member's active bands. */
export async function countMemberPastShows(userId: string): Promise<number> {
	const [row] = await db
		.select({ value: count() })
		.from(event)
		.where(
			and(
				confirmedForMember(userId),
				eq(event.status, 'published'),
				lte(event.startsAt, new Date())
			)
		);
	return row?.value ?? 0;
}

// ---------------------------------------------------------------------------
// Public calendar
// ---------------------------------------------------------------------------

export interface CalendarEventRow extends EventRow {
	bandName: string | null;
	bandSlug: string | null;
}

/**
 * Publicly visible events with startsAt in [start, end), across sources, band
 * info joined for attribution.
 *
 * "Publicly visible" is published *or cancelled*, not just published. A
 * cancellation is an announcement — the people who need it are exactly the ones
 * who already had the date — so a cancelled show stays on the guide, marked, and
 * ages off on its own date like everything else. Never returns `draft`,
 * `pending_review` or `rejected`: those were never public and must not become
 * so.
 */
export async function listPublicCalendarEvents(
	start: Date,
	end: Date
): Promise<CalendarEventRow[]> {
	const rows = await db
		.select({ event, bandName: group.name, bandSlug: group.slug })
		.from(event)
		.leftJoin(group, eq(group.id, event.groupId))
		.where(
			and(
				inArray(event.status, [...publicEventStatuses]),
				gte(event.startsAt, start),
				lt(event.startsAt, end)
			)
		)
		.orderBy(asc(event.startsAt));

	return rows.map((r) => ({ ...r.event, bandName: r.bandName, bandSlug: r.bandSlug }));
}

/**
 * Publicly visible events from `from` forward, across sources, ordered
 * soonest-first, band info joined. Fetches limit+1 rows so callers can derive
 * hasMore; band and community listings are included alongside CMC ones.
 *
 * Includes cancelled events — see listPublicCalendarEvents for why. The hero
 * posters deliberately do NOT use this (they call listUpcoming), because a dead
 * show shouldn't hold a hero slot.
 */
export async function listPublicUpcomingEvents(
	from: Date,
	opts: { limit: number; offset: number }
): Promise<CalendarEventRow[]> {
	const rows = await db
		.select({ event, bandName: group.name, bandSlug: group.slug })
		.from(event)
		.leftJoin(group, eq(group.id, event.groupId))
		.where(and(inArray(event.status, [...publicEventStatuses]), gte(event.startsAt, from)))
		.orderBy(asc(event.startsAt))
		.limit(opts.limit + 1)
		.offset(opts.offset);

	return rows.map((r) => ({ ...r.event, bandName: r.bandName, bandSlug: r.bandSlug }));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
