import { db } from '$lib/server/db';
import { recurringSeries } from '$lib/server/db/schema/recurring';
import { reservation } from '$lib/server/db/schema/reservation';
import { closure } from '$lib/server/db/schema/reservation';
import { event, eventBand } from '$lib/server/db/schema/event';
import { group } from '$lib/server/db/schema/group';
import { directoryEntry } from '$lib/server/db/schema/directory';
import { linkManagingGroup } from '$lib/server/event/event-service';
import { user } from '$lib/server/db/schema/authentication';
import { and, eq, isNull, lt, gt, gte, lte, ne, notInArray, or, sql } from 'drizzle-orm';
import { getOccurrences, generationWindowEnd } from './rrule-helpers';
import { formatDateInTz, formatTimeInTz } from './timezone';
import { staffCreate } from './reservation-service';
import { hasConflict } from './conflict-service';
import { attachExisting } from '$lib/server/media/media-service';
import { domainEvents } from '$lib/server/event-bus/event-bus';
import { captureException } from '$lib/server/sentry';
import { DEFAULT_TIMEZONE } from '$lib/config';

// ---------------------------------------------------------------------------
// Generation job — expand active recurring series into concrete reservations
// ---------------------------------------------------------------------------

const TZ = DEFAULT_TIMEZONE;

export interface GenerationResult {
	seriesProcessed: number;
	instancesCreated: number;
	instancesWaitlisted: number;
	instancesSkipped: number;
	errors: string[];
}

/**
 * Main entry point. Processes all active series with prototype_type = 'reservation'.
 * Each series is processed independently — one failure doesn't block others.
 */
export async function generateRecurringReservations(): Promise<GenerationResult> {
	const result: GenerationResult = {
		seriesProcessed: 0,
		instancesCreated: 0,
		instancesWaitlisted: 0,
		instancesSkipped: 0,
		errors: []
	};

	// Fetch all active reservation series
	const activeSeries = await db
		.select({
			id: recurringSeries.id,
			prototypeId: recurringSeries.prototypeId,
			rrule: recurringSeries.rrule,
			endsAt: recurringSeries.endsAt
		})
		.from(recurringSeries)
		.where(
			and(
				eq(recurringSeries.prototypeType, 'reservation'),
				isNull(recurringSeries.cancelledAt),
				isNull(recurringSeries.supersededBy),
				or(isNull(recurringSeries.endsAt), gt(recurringSeries.endsAt, sql`(current_timestamp)`))
			)
		);

	for (const series of activeSeries) {
		try {
			const counts = await processSeries(series);
			result.instancesCreated += counts.created;
			result.instancesWaitlisted += counts.waitlisted;
			result.instancesSkipped += counts.skipped;
			result.seriesProcessed++;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			result.errors.push(`Series ${series.id}: ${msg}`);
		}
	}

	return result;
}

// ---------------------------------------------------------------------------
// Combined entry point — events first, then reservations
// ---------------------------------------------------------------------------

/**
 * Expand all active recurring series. Events are processed BEFORE reservations:
 * recurring events book `bookerType: 'event'` reservations that the reservation
 * pass treats as hard blocks, so generating events first lets the reservation
 * pass step aside instead of grabbing a slot a recurring event needs.
 */
export async function generateRecurring(): Promise<{
	events: GenerationResult;
	reservations: GenerationResult;
}> {
	const events = await generateRecurringEvents();
	const reservations = await generateRecurringReservations();
	return { events, reservations };
}

// ---------------------------------------------------------------------------
// Per-series processing
// ---------------------------------------------------------------------------

interface SeriesInfo {
	id: string;
	prototypeId: string;
	rrule: string;
	endsAt: Date | null;
}

async function processSeries(
	series: SeriesInfo
): Promise<{ created: number; waitlisted: number; skipped: number }> {
	// Load the prototype reservation
	const [prototype] = await db
		.select({
			bookerType: reservation.bookerType,
			bookerId: reservation.bookerId,
			createdByUserId: reservation.createdByUserId,
			startsAt: reservation.startsAt,
			endsAt: reservation.endsAt,
			notes: reservation.notes
		})
		.from(reservation)
		.where(eq(reservation.id, series.prototypeId))
		.limit(1);

	if (!prototype) {
		throw new Error('Prototype reservation not found');
	}

	// Load user info for event emission
	const [owner] = await db
		.select({ name: user.name, email: user.email })
		.from(user)
		.where(eq(user.id, prototype.createdByUserId))
		.limit(1);

	// Compute prototype duration in ms
	const durationMs = prototype.endsAt.getTime() - prototype.startsAt.getTime();

	// Generate occurrences within the window
	const now = new Date();
	let windowEnd = await generationWindowEnd(now);
	if (series.endsAt && series.endsAt < windowEnd) {
		windowEnd = series.endsAt;
	}
	const occurrences = getOccurrences(series.rrule, now, windowEnd);

	// Batch-fetch all existing instances for this series in the window
	const existingInstances =
		occurrences.length > 0
			? await db
					.select({ startsAt: reservation.startsAt })
					.from(reservation)
					.where(
						and(
							eq(reservation.recurringSeriesId, series.id),
							gte(reservation.startsAt, occurrences[0]),
							lte(reservation.startsAt, occurrences[occurrences.length - 1])
						)
					)
			: [];

	const existingTimes = new Set(existingInstances.map((r) => r.startsAt.getTime()));

	let created = 0;
	let waitlisted = 0;
	let skipped = 0;

	for (const occStart of occurrences) {
		const occEnd = new Date(occStart.getTime() + durationMs);

		// Already generated (or was generated and cancelled) — skip
		if (existingTimes.has(occStart.getTime())) {
			continue;
		}

		// Tier 1: Check for conflicts with events and closures — hard skip
		const eventConflict = await checkEventAndClosureConflict(occStart, occEnd);

		if (eventConflict) {
			skipped++;

			if (owner) {
				await domainEvents.emit('reservation.recurring_skipped', {
					seriesId: series.id,
					userId: prototype.createdByUserId,
					userName: owner.name,
					userEmail: owner.email,
					skippedDate: formatDateInTz(occStart, TZ),
					startTime: formatTimeInTz(occStart, TZ),
					endTime: formatTimeInTz(occEnd, TZ),
					reason: eventConflict.reason
				});
			}

			continue;
		}

		// Tier 2: Check for conflicts with regular reservations — waitlist
		const hasRegularConflict = await checkReservationConflict(occStart, occEnd, series.id);

		if (hasRegularConflict) {
			await db.insert(reservation).values({
				bookerType: prototype.bookerType,
				bookerId: prototype.bookerId,
				createdByUserId: prototype.createdByUserId,
				status: 'waitlisted',
				startsAt: occStart,
				endsAt: occEnd,
				notes: prototype.notes,
				recurringSeriesId: series.id
			});

			waitlisted++;

			if (owner) {
				await domainEvents.emit('reservation.recurring_waitlisted', {
					seriesId: series.id,
					userId: prototype.createdByUserId,
					userName: owner.name,
					userEmail: owner.email,
					date: formatDateInTz(occStart, TZ),
					startTime: formatTimeInTz(occStart, TZ),
					endTime: formatTimeInTz(occEnd, TZ),
					reason: 'Time slot is currently booked'
				});
			}

			continue;
		}

		// No conflict — create as scheduled
		await db.insert(reservation).values({
			bookerType: prototype.bookerType,
			bookerId: prototype.bookerId,
			createdByUserId: prototype.createdByUserId,
			status: 'scheduled',
			startsAt: occStart,
			endsAt: occEnd,
			notes: prototype.notes,
			recurringSeriesId: series.id
		});

		created++;
	}

	return { created, waitlisted, skipped };
}

// ---------------------------------------------------------------------------
// Conflict checking — events and closures only (not one-off reservations)
// ---------------------------------------------------------------------------

interface ConflictInfo {
	reason: string;
}

async function checkEventAndClosureConflict(
	startsAt: Date,
	endsAt: Date
): Promise<ConflictInfo | null> {
	// Check event-type reservations
	const eventConflicts = await db
		.select({ id: reservation.id })
		.from(reservation)
		.where(
			and(
				eq(reservation.bookerType, 'event'),
				notInArray(reservation.status, ['cancelled', 'waitlisted']),
				lt(reservation.startsAt, endsAt),
				gt(reservation.endsAt, startsAt)
			)
		)
		.limit(1);

	if (eventConflicts.length > 0) {
		return { reason: 'Scheduled event' };
	}

	// Check closures
	const closureConflicts = await db
		.select({ reason: closure.reason })
		.from(closure)
		.where(and(lt(closure.startsAt, endsAt), gt(closure.endsAt, startsAt)))
		.limit(1);

	if (closureConflicts.length > 0) {
		return { reason: closureConflicts[0].reason };
	}

	return null;
}

/**
 * Check if any regular (non-event) reservation overlaps the time range,
 * excluding reservations from the same series to avoid self-conflict.
 */
async function checkReservationConflict(
	startsAt: Date,
	endsAt: Date,
	seriesId: string
): Promise<boolean> {
	const conflicts = await db
		.select({ id: reservation.id })
		.from(reservation)
		.where(
			and(
				notInArray(reservation.status, ['cancelled', 'waitlisted']),
				lt(reservation.startsAt, endsAt),
				gt(reservation.endsAt, startsAt),
				or(isNull(reservation.recurringSeriesId), ne(reservation.recurringSeriesId, seriesId))
			)
		)
		.limit(1);

	return conflicts.length > 0;
}

// ---------------------------------------------------------------------------
// Event generation — expand active recurring series into draft events
// ---------------------------------------------------------------------------

/**
 * Processes all active series with prototype_type = 'event'. Each occurrence is
 * materialized as an independent draft event copying the prototype's details. If
 * the prototype reserved space, each occurrence books and links its own
 * reservation; when that slot conflicts the draft event is still created without
 * a reservation and staff are notified.
 *
 * `instancesCreated` counts draft events created. `instancesSkipped` counts
 * occurrences whose space reservation could not be booked (the event still exists).
 */
export async function generateRecurringEvents(): Promise<GenerationResult> {
	const result: GenerationResult = {
		seriesProcessed: 0,
		instancesCreated: 0,
		instancesWaitlisted: 0,
		instancesSkipped: 0,
		errors: []
	};

	const activeSeries = await db
		.select({
			id: recurringSeries.id,
			prototypeId: recurringSeries.prototypeId,
			rrule: recurringSeries.rrule,
			endsAt: recurringSeries.endsAt
		})
		.from(recurringSeries)
		.where(
			and(
				eq(recurringSeries.prototypeType, 'event'),
				isNull(recurringSeries.cancelledAt),
				isNull(recurringSeries.supersededBy),
				or(isNull(recurringSeries.endsAt), gt(recurringSeries.endsAt, sql`(current_timestamp)`))
			)
		);

	for (const series of activeSeries) {
		try {
			const counts = await processEventSeries(series);
			result.instancesCreated += counts.created;
			result.instancesSkipped += counts.skipped;
			result.seriesProcessed++;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			result.errors.push(`Series ${series.id}: ${msg}`);
		}
	}

	return result;
}

async function processEventSeries(
	series: SeriesInfo
): Promise<{ created: number; skipped: number }> {
	// Load the prototype event
	const [prototype] = await db
		.select()
		.from(event)
		.where(eq(event.id, series.prototypeId))
		.limit(1);

	if (!prototype) {
		throw new Error('Prototype event not found');
	}

	// Load creator info for staff notifications
	const [owner] = await db
		.select({ name: user.name, email: user.email })
		.from(user)
		.where(eq(user.id, prototype.createdByUserId))
		.limit(1);

	// `event_cmc_needs_end` guarantees this for a CMC prototype, and
	// `createGroupEvent` requires it for a program's. Still checked rather than
	// asserted, because this runs unattended and because the guarantee no longer
	// comes from one place — a silent NaN duration would generate a whole series
	// of broken occurrences.
	if (!prototype.endsAt) {
		throw new Error(`Recurring prototype ${prototype.id} has no end time`);
	}
	const protoEndsAt = prototype.endsAt;

	// Offsets relative to the prototype event, applied to every occurrence
	const durationMs = protoEndsAt.getTime() - prototype.startsAt.getTime();
	const doorsLeadMs = prototype.doorsAt
		? prototype.startsAt.getTime() - prototype.doorsAt.getTime()
		: null;

	// If the prototype reserved space, capture the reservation's lead/tail so each
	// occurrence reserves an equivalent window (reservation times can differ from
	// event times for setup/teardown).
	let resLeadMs: number | null = null;
	let resTailMs: number | null = null;
	if (prototype.reservationId) {
		const [protoRes] = await db
			.select({ startsAt: reservation.startsAt, endsAt: reservation.endsAt })
			.from(reservation)
			.where(eq(reservation.id, prototype.reservationId))
			.limit(1);
		if (protoRes) {
			resLeadMs = prototype.startsAt.getTime() - protoRes.startsAt.getTime();
			resTailMs = protoRes.endsAt.getTime() - protoEndsAt.getTime();
		}
	}

	// Generate occurrences within the window
	const now = new Date();
	let windowEnd = await generationWindowEnd(now);
	if (series.endsAt && series.endsAt < windowEnd) {
		windowEnd = series.endsAt;
	}
	const occurrences = getOccurrences(series.rrule, now, windowEnd);

	// Skip occurrences already materialized for this series
	const existingInstances =
		occurrences.length > 0
			? await db
					.select({ startsAt: event.startsAt })
					.from(event)
					.where(
						and(
							eq(event.recurringSeriesId, series.id),
							gte(event.startsAt, occurrences[0]),
							lte(event.startsAt, occurrences[occurrences.length - 1])
						)
					)
			: [];
	const existingTimes = new Set(existingInstances.map((r) => r.startsAt.getTime()));

	/**
	 * An occurrence is the prototype repeated, so it inherits what the prototype
	 * *is* — not a fixed CMC draft.
	 *
	 * This used to hard-code `source: 'cmc'` and `status: 'draft'` and to copy
	 * neither the owner nor the location. Latent until now only because nothing
	 * but a staff CMC event could be a prototype; the moment a club's jam can be
	 * one, the old shape would have generated CMC-attributed drafts that reached
	 * nobody and held no room, week after week, unattended.
	 *
	 * **Publishing automatically is conditional, and that is the decision the
	 * spec makes rather than defers.** A CMC series keeps generating drafts,
	 * because staff review is a step that already exists and removing it silently
	 * would be a change nobody asked for. Everything else publishes: a program's
	 * recurring session that sits in draft is a session its members are never
	 * told about.
	 */
	const inheritsCmcReview = prototype.source === 'cmc';
	const occurrenceStatus = inheritsCmcReview ? ('draft' as const) : ('published' as const);

	// The owner's display name, for the lineup credit a band occurrence owes.
	// Looked up once rather than per occurrence.
	const [ownerGroup] =
		prototype.source === 'band' && prototype.groupId
			? await db
					.select({ name: group.name })
					.from(group)
					.where(eq(group.id, prototype.groupId))
					.limit(1)
			: [undefined];

	// The band's `directory_entry`, which is what a credit names after the
	// phase-10 re-key. Looked up once per series, like the name above it.
	const [ownerEntry] =
		prototype.source === 'band' && prototype.groupId
			? await db
					.select({ id: directoryEntry.id })
					.from(directoryEntry)
					.where(eq(directoryEntry.groupId, prototype.groupId))
					.limit(1)
			: [undefined];
	const ownerEntryId = ownerEntry?.id ?? null;

	let created = 0;
	let skipped = 0;

	for (const occStart of occurrences) {
		if (existingTimes.has(occStart.getTime())) continue;

		const occEnd = new Date(occStart.getTime() + durationMs);
		const occDoors = doorsLeadMs != null ? new Date(occStart.getTime() - doorsLeadMs) : null;

		const newEventId = crypto.randomUUID();

		// Insert the draft event first (no reservation), so a failed space booking
		// never leaves an orphan reservation.
		await db.insert(event).values({
			id: newEventId,
			title: prototype.title,
			description: prototype.description,
			startsAt: occStart,
			endsAt: occEnd,
			doorsAt: occDoors,
			tags: prototype.tags,
			ticketingEnabled: prototype.ticketingEnabled,
			ticketPrice: prototype.ticketPrice,
			ticketQuantity: prototype.ticketQuantity,
			// Inherited, all four. `location` matters for the same reason as the
			// rest: an occurrence that lost it reads as being held somewhere it is
			// not.
			source: prototype.source,
			groupId: prototype.groupId,
			location: prototype.location,
			status: occurrenceStatus,
			publishedAt: occurrenceStatus === 'published' ? new Date() : null,
			createdByUserId: prototype.createdByUserId,
			recurringSeriesId: series.id
		});
		created++;

		// The two invariants a write that sets `groupId` owes. They are maintained
		// here rather than by calling `createGroupEvent`/`createBandEvent`, because
		// this path deliberately inserts the event *before* booking the room —
		// reversing that order is what keeps a failed booking from orphaning a
		// reservation, and it is the opposite of what those creators do.
		if (prototype.groupId) {
			await linkManagingGroup([{ eventId: newEventId, groupId: prototype.groupId }]);

			// A band gig's owner heads its own bill. A program's session has no bill
			// at all — see `createGroupEvent`.
			if (prototype.source === 'band') {
				await db.insert(eventBand).values({
					eventId: newEventId,
					name: ownerGroup?.name ?? 'Unknown band',
					// Both, while `bandId` still exists — see the column comment.
					bandId: prototype.groupId,
					directoryEntryId: ownerEntryId,
					billingOrder: 0,
					status: 'confirmed',
					addedByBandId: prototype.groupId
				});
			}
		}

		// Point the occurrence at the prototype's poster — the same R2 object, not a
		// copy of it.
		//
		// This used to `copyObject` per occurrence, and the reason given was that an
		// occurrence must be independently editable and cancellable. It had to be:
		// deleting or re-postering one event deleted the object outright, so a
		// shared key would have been pulled out from under its siblings. Since
		// phase 4 nothing in a request path deletes an object — cancelling detaches,
		// and the sweep only reclaims what no attachment points at — so sharing is
		// now the safe option rather than the dangerous one, and a 52-week series
		// holds one JPEG instead of 52. See docs/specs/shipped/media-spec.md.
		if (prototype.posterKey) {
			try {
				const attached = await attachExisting('event', newEventId, 'poster', prototype.posterKey);

				// No `media` row for the prototype's key means something wrote a poster
				// without recording it — the backfill covered every key that existed,
				// and every write path has recorded one since. Share the key anyway: a
				// missing poster is an immediate regression, while a missing attachment
				// is a latent one the sweep would surface. Reported either way.
				if (!attached) {
					captureException(new Error(`No media row for prototype poster ${prototype.posterKey}`), {
						event: 'event.recurring.poster_unrecorded',
						eventId: newEventId
					});
				}

				await db
					.update(event)
					.set({ posterKey: prototype.posterKey, updatedAt: new Date() })
					.where(eq(event.id, newEventId));
			} catch (err) {
				// Best-effort: the draft event remains; staff can add a poster manually.
				captureException(err, { event: 'event.recurring.poster', eventId: newEventId });
			}
		}

		// Book space for this occurrence if the prototype reserved space
		if (resLeadMs != null && resTailMs != null) {
			const occResStart = new Date(occStart.getTime() - resLeadMs);
			const occResEnd = new Date(occEnd.getTime() + resTailMs);

			try {
				const conflict = await hasConflict(occResStart, occResEnd);
				if (conflict) {
					skipped++;
					if (owner) {
						await domainEvents.emit('event.recurring_reservation_skipped', {
							seriesId: series.id,
							eventId: newEventId,
							eventTitle: prototype.title,
							userId: prototype.createdByUserId,
							userName: owner.name,
							userEmail: owner.email,
							date: formatDateInTz(occStart, TZ),
							startTime: formatTimeInTz(occResStart, TZ),
							endTime: formatTimeInTz(occResEnd, TZ),
							reason: 'Time slot is currently booked'
						});
					}
				} else {
					const res = await staffCreate({
						userId: prototype.createdByUserId,
						bookerType: 'event',
						bookerId: newEventId,
						startsAt: occResStart,
						endsAt: occResEnd,
						// Same as the one-off path: event space is staff-held. A `scheduled`
						// hold reads as an uncommitted member booking that nothing can ever
						// confirm, so the unconfirmed sweep released the room at showtime.
						status: 'confirmed'
					});
					await db
						.update(event)
						.set({ reservationId: res.id, updatedAt: new Date() })
						.where(eq(event.id, newEventId));
				}
			} catch (err) {
				// Best-effort: the draft event remains; staff can book space manually.
				captureException(err, { event: 'event.recurring.reserve', eventId: newEventId });
			}
		}
	}

	return { created, skipped };
}
