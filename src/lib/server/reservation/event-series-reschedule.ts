import { db, getRowCount } from '#lib/server/db/index.js';
import { recurringSeries } from '#lib/server/db/schema/recurring.js';
import { closure, reservation } from '#lib/server/db/schema/reservation.js';
import { eventBand, eventListing } from '#lib/server/db/schema/event.js';
import { eventRsvp } from '#lib/server/db/schema/event-rsvp.js';
import { ticket } from '#lib/server/db/schema/ticket.js';
import { sponsorPlacement } from '#lib/server/db/schema/sponsor.js';
import { marketDay, marketVendor } from '#lib/server/db/schema/market.js';
import { artifactRequest } from '#lib/server/db/schema/artifact-request.js';
import { donation } from '#lib/server/db/schema/donation.js';
import { incident } from '#lib/server/db/schema/incident.js';
import { workOrder } from '#lib/server/db/schema/volunteer.js';
import { campaign } from '#lib/server/db/schema/marketing.js';
import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, ne, notInArray, sql } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { detachSlot } from '#lib/server/media/media-service.js';
import { buildRRule, generationWindowEnd, getOccurrences } from './rrule-helpers';
import { cancel as cancelReservation, staffCreate } from './reservation-service';
import { listingHoldBooker } from './event-hold';
import {
	copyListing,
	generateEventSeries,
	loadEventPrototype,
	seriesContext,
	type EventPrototype
} from './generation-job';
import { cancelArgs, RecurringSeriesError, type SeriesCanceller } from './recurring-series-service';
import {
	changeDay,
	checkShape,
	type BookingTimes,
	type NewSchedule,
	type PlannedSession,
	type ReschedulePreview,
	type RescheduleOutcome
} from './recurring-series-reschedule';

// ---------------------------------------------------------------------------
// Event series — decision 0072 applied to `event_listing` prototypes
// ---------------------------------------------------------------------------

const RESCHEDULE_REASON = 'Recurring schedule changed';

/**
 * Every column that points at a listing and is a record someone made: an
 * occurrence with any of them is kept rather than removed. The generator's own
 * rows (`event_group`, `ticket_sale`) are not records. `event-series-touch.spec`
 * fails when a new reference to `event_listing` is in neither list.
 */
export const LISTING_RECORDS: SQLiteColumn[] = [
	eventRsvp.eventId,
	ticket.eventId,
	eventBand.eventId,
	sponsorPlacement.eventId,
	marketDay.eventId,
	marketVendor.eventId,
	artifactRequest.eventId,
	donation.eventId,
	incident.eventId,
	workOrder.eventId,
	campaign.eventId
];

/** An occurrence no record touches, which a schedule change may delete. */
const untouched = () =>
	and(
		isNull(eventListing.projectId),
		...LISTING_RECORDS.map(
			(col) => sql`NOT EXISTS (SELECT 1 FROM ${col.table} WHERE ${col} = ${eventListing.id})`
		)
	);

export async function seriesPrototype(seriesId: string) {
	const [row] = await db
		.select({ type: recurringSeries.prototypeType, id: recurringSeries.prototypeId })
		.from(recurringSeries)
		.where(eq(recurringSeries.id, seriesId))
		.limit(1);
	return row ?? null;
}

interface ActiveEventSeries {
	id: string;
	prototype: EventPrototype & { endsAt: Date };
	/** The room hold's setup and teardown around the listing, when it holds the room. */
	hold: { leadMs: number; tailMs: number } | null;
}

async function loadActive(seriesId: string): Promise<ActiveEventSeries> {
	const [row] = await db
		.select({ id: recurringSeries.id, prototypeId: recurringSeries.prototypeId })
		.from(recurringSeries)
		.where(
			and(
				eq(recurringSeries.id, seriesId),
				eq(recurringSeries.prototypeType, 'event_listing'),
				isNull(recurringSeries.cancelledAt),
				isNull(recurringSeries.supersededBy)
			)
		)
		.limit(1);
	const prototype = row && (await loadEventPrototype(row.prototypeId));
	if (!row || !prototype) throw new RecurringSeriesError('Series not found or already cancelled');
	if (!prototype.endsAt) throw new RecurringSeriesError('The series has no end time');
	const { endsAt } = prototype;

	const [res] = prototype.reservationId
		? await db
				.select({ startsAt: reservation.startsAt, endsAt: reservation.endsAt })
				.from(reservation)
				.where(eq(reservation.id, prototype.reservationId))
				.limit(1)
		: [];
	const hold = res
		? {
				leadMs: prototype.startsAt.getTime() - res.startsAt.getTime(),
				tailMs: res.endsAt.getTime() - endsAt.getTime()
			}
		: null;
	return { id: row.id, prototype: { ...prototype, endsAt }, hold };
}

/** Old-schedule occurrences from the change day on, split by whether they may go. */
async function oldOccurrences(seriesId: string, from: Date) {
	const rows = await db
		.select({
			id: eventListing.id,
			startsAt: eventListing.startsAt,
			endsAt: eventListing.endsAt,
			reservationId: eventListing.reservationId,
			untouched: sql<number>`${untouched()}`.mapWith(Number)
		})
		.from(eventListing)
		.where(
			and(
				eq(eventListing.recurringSeriesId, seriesId),
				gte(eventListing.startsAt, from),
				ne(eventListing.status, 'cancelled')
			)
		)
		.orderBy(asc(eventListing.startsAt));
	const times = rows.map((r) => ({ ...r, endsAt: r.endsAt ?? r.startsAt }));
	return { removable: times.filter((r) => r.untouched), kept: times.filter((r) => !r.untouched) };
}

function holdWindow(series: ActiveEventSeries, startsAt: Date, endsAt: Date) {
	if (!series.hold) return null;
	return {
		startsAt: new Date(startsAt.getTime() - series.hold.leadMs),
		endsAt: new Date(endsAt.getTime() + series.hold.tailMs)
	};
}

/**
 * The conflict a hold would meet, leaving out `released`: the old holds this
 * change gives back. A closure or another show refuses; a booking waitlists.
 */
async function holdConflict(
	window: { startsAt: Date; endsAt: Date } | null,
	released: string[]
): Promise<PlannedSession['conflict']> {
	if (!window) return null;
	const [closed] = await db
		.select({ id: closure.id })
		.from(closure)
		.where(and(lt(closure.startsAt, window.endsAt), gt(closure.endsAt, window.startsAt)))
		.limit(1);
	if (closed) return 'closed';
	const [taken] = await db
		.select({ hardHold: reservation.hardHold })
		.from(reservation)
		.where(
			and(
				notInArray(reservation.status, ['cancelled', 'waitlisted']),
				lt(reservation.startsAt, window.endsAt),
				gt(reservation.endsAt, window.startsAt),
				released.length ? notInArray(reservation.id, released) : undefined
			)
		)
		.orderBy(desc(reservation.hardHold))
		.limit(1);
	if (!taken) return null;
	return taken.hardHold ? 'closed' : 'booked';
}

const withReason = ([userId, options]: ReturnType<typeof cancelArgs>) =>
	[userId, RESCHEDULE_REASON, options] as const;

const holdsOf = (rows: { reservationId: string | null }[]) =>
	rows.flatMap((r) => (r.reservationId ? [r.reservationId] : []));

export async function previewEventReschedule(
	seriesId: string,
	schedule: NewSchedule
): Promise<ReschedulePreview> {
	const series = await loadActive(seriesId);
	const { removable, kept } = await oldOccurrences(series.id, changeDay(schedule));
	const released = holdsOf(removable);

	const rrule = buildRRule(schedule.startsAt, schedule.frequency, schedule.monthlyMode);
	// A requested session length, not a stored window: no tour is held in it.
	const { startsAt: first, endsAt: firstEnd } = schedule;
	const durationMs = firstEnd.getTime() - first.getTime();
	const window = await generationWindowEnd(new Date(), 'production');
	let horizon = window > schedule.endsAt ? window : schedule.endsAt;
	if (schedule.until && schedule.until < horizon) horizon = schedule.until;
	const starts = getOccurrences(rrule, new Date(schedule.startsAt.getTime() - 1), horizon);

	const sessions: PlannedSession[] = [];
	for (const startsAt of starts.slice(0, 8)) {
		const endsAt = new Date(startsAt.getTime() + durationMs);
		const conflict = await holdConflict(holdWindow(series, startsAt, endsAt), released);
		sessions.push({ startsAt, endsAt, conflict });
	}
	return {
		sessions,
		kept: kept.map(({ id, startsAt, endsAt }) => ({ id, startsAt, endsAt })),
		removed: removable.length
	};
}

/**
 * Replaces an event series with one on `schedule`, as `reschedule` does for a
 * booking series. Each occurrence's room hold goes with it: a removed
 * occurrence's hold is cancelled, and the new first session holds the room for
 * the same setup and teardown, waitlisted behind a booking.
 */
export async function rescheduleEventSeries(
	seriesId: string,
	schedule: NewSchedule,
	by: SeriesCanceller
): Promise<RescheduleOutcome & { eventId: string }> {
	checkShape(schedule);
	const series = await loadActive(seriesId);
	const { prototype } = series;
	const { removable, kept } = await oldOccurrences(series.id, changeDay(schedule));

	const window = holdWindow(series, schedule.startsAt, schedule.endsAt);
	const conflict = await holdConflict(window, holdsOf(removable));
	if (conflict === 'closed') {
		throw new RecurringSeriesError('The first session clashes with a closure or another event');
	}
	const waitlisted = conflict === 'booked';

	const context = await seriesContext(prototype);
	const eventId = await copyListing(prototype, context, { ...schedule, seriesId: null });
	const hold = window
		? await staffCreate({
				userId: prototype.createdByUserId,
				staffUserId: by.kind === 'staff' ? by.userId : undefined,
				...listingHoldBooker({ id: eventId, productionId: null, groupId: prototype.groupId }),
				hardHold: true,
				startsAt: window.startsAt,
				endsAt: window.endsAt,
				status: waitlisted ? 'waitlisted' : 'confirmed'
			})
		: null;

	const newId = crypto.randomUUID();
	const now = new Date();
	// The old prototype stays a row: the old series and its history point at it.
	const toDelete = removable.filter((r) => r.id !== prototype.id).map((r) => r.id);
	const [superseded, , , deleted] = await db.batch([
		db
			.update(recurringSeries)
			.set({ cancelledAt: now, supersededBy: newId })
			.where(
				and(
					eq(recurringSeries.id, series.id),
					isNull(recurringSeries.cancelledAt),
					isNull(recurringSeries.supersededBy)
				)
			),
		db.insert(recurringSeries).values({
			id: newId,
			prototypeType: 'event_listing',
			prototypeId: eventId,
			rrule: buildRRule(schedule.startsAt, schedule.frequency, schedule.monthlyMode),
			createdBy: prototype.createdByUserId,
			endsAt: schedule.until ?? null
		}),
		db
			.update(eventListing)
			.set({ recurringSeriesId: newId, reservationId: hold?.id ?? null, updatedAt: now })
			.where(eq(eventListing.id, eventId)),
		// `untouched` is re-checked here, so an occurrence someone RSVP'd to since the read is kept.
		db
			.delete(eventListing)
			.where(
				and(
					inArray(eventListing.id, toDelete),
					eq(eventListing.recurringSeriesId, series.id),
					untouched(),
					sql`EXISTS (SELECT 1 FROM ${recurringSeries} WHERE ${recurringSeries.id} = ${series.id} AND ${recurringSeries.supersededBy} = ${newId})`
				)
			)
			.returning({ id: eventListing.id, reservationId: eventListing.reservationId })
	]);
	if (getRowCount(superseded) === 0) {
		// Another request ended the series first; take back what this one wrote.
		if (hold) await cancelReservation(hold.id, ...withReason(cancelArgs({ kind: 'system' })));
		await db.delete(eventListing).where(eq(eventListing.id, eventId));
		throw new RecurringSeriesError('Series not found or already cancelled');
	}

	const outcome = {
		eventId,
		seriesId: newId,
		waitlisted,
		removed: deleted.map((r) => r.id),
		kept: [] as BookingTimes[],
		errors: [] as string[]
	};
	const attempt = async (what: string, fn: () => Promise<unknown>) => {
		try {
			await fn();
			return true;
		} catch (err) {
			outcome.errors.push(`${what}: ${(err as Error).message}`);
			return false;
		}
	};
	const [userId, options] = cancelArgs(by);
	const release = (holdId: string) =>
		attempt(`release ${holdId}`, () =>
			cancelReservation(holdId, userId, RESCHEDULE_REASON, options)
		);

	for (const row of deleted) {
		await attempt(`detach ${row.id}`, () => detachSlot('event_listing', row.id, 'poster'));
		if (row.reservationId) await release(row.reservationId);
	}
	const oldPrototype = removable.find((r) => r.id === prototype.id);
	if (oldPrototype) {
		const ok = await attempt('cancel old prototype', () =>
			db
				.update(eventListing)
				.set({ status: 'cancelled', updatedAt: now })
				.where(eq(eventListing.id, oldPrototype.id))
		);
		if (ok) {
			outcome.removed.push(oldPrototype.id);
			await attempt('detach old prototype', () =>
				detachSlot('event_listing', oldPrototype.id, 'poster')
			);
			if (oldPrototype.reservationId) await release(oldPrototype.reservationId);
		}
	}

	const gone = new Set(outcome.removed);
	outcome.kept = [...kept, ...removable.filter((r) => !gone.has(r.id))]
		.map(({ id, startsAt, endsAt }) => ({ id, startsAt, endsAt }))
		.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

	await attempt('generate', () => generateEventSeries(newId));
	for (const msg of outcome.errors) console.error(`[recurring] reschedule ${seriesId}: ${msg}`);
	return outcome;
}
