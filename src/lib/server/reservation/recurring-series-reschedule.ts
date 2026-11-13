import { db, getRowCount } from '#lib/server/db/index.js';
import { recurringSeries } from '#lib/server/db/schema/recurring.js';
import { reservation } from '#lib/server/db/schema/reservation.js';
import { user } from '#lib/server/db/schema/authentication.js';
import type { RecurringFrequency } from '#lib/server/db/schema/recurring.js';
import type { BookerType } from '#lib/config.js';
import { DEFAULT_TIMEZONE } from '#lib/config.js';
import { and, asc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { domainEvents } from '#lib/server/event-bus/event-bus.js';
import { buildRRule, generationWindowEnd, getOccurrences, type MonthlyMode } from './rrule-helpers';
import { buildDateInTz, formatDateInTz, formatTimeInTz } from './timezone';
import { validateBooking } from './conflict-service';
import { insertReservation } from './insert-reservation';
import { announceConfirmed, cancel as cancelReservation } from './reservation-service';
import { promoteNextWaitlisted } from './waitlist-service';
import {
	checkEventAndClosureConflict,
	checkReservationConflict,
	generateSeries
} from './generation-job';
import {
	cancelArgs,
	deletable,
	LIVE_STATUSES,
	RecurringSeriesError,
	type SeriesCanceller
} from './recurring-series-service';

// ---------------------------------------------------------------------------
// reschedule() — replace a reservation series with one on a new schedule
// ---------------------------------------------------------------------------

const TZ = DEFAULT_TIMEZONE;
const RESCHEDULE_REASON = 'Recurring schedule changed';

export interface NewSchedule {
	/** The first session of the new schedule. */
	startsAt: Date;
	endsAt: Date;
	frequency: RecurringFrequency;
	monthlyMode?: MonthlyMode;
	/** Last day, inclusive; open-ended when absent. */
	until?: Date;
}

export interface BookingTimes {
	id: string;
	startsAt: Date;
	endsAt: Date;
}

export interface PlannedSession {
	startsAt: Date;
	endsAt: Date;
	/** `closed` is skipped by generation; `booked` is waitlisted. */
	conflict: 'closed' | 'booked' | null;
}

export interface ReschedulePreview {
	sessions: PlannedSession[];
	/** Old-schedule bookings that stay because money or a record touches them. */
	kept: BookingTimes[];
	/** How many untouched old-schedule bookings the change removes. */
	removed: number;
}

export interface RescheduleOutcome {
	seriesId: string;
	waitlisted: boolean;
	/** Old-schedule bookings deleted, or cancelled when one is the old prototype. */
	removed: string[];
	kept: BookingTimes[];
	errors: string[];
}

interface ActiveSeries {
	id: string;
	prototypeId: string;
	bookerType: BookerType;
	bookerId: string;
	createdByUserId: string;
	notes: string | null;
}

async function loadActive(seriesId: string): Promise<ActiveSeries> {
	const [row] = await db
		.select({
			id: recurringSeries.id,
			prototypeId: recurringSeries.prototypeId,
			bookerType: reservation.bookerType,
			bookerId: reservation.bookerId,
			createdByUserId: reservation.createdByUserId,
			notes: reservation.notes
		})
		.from(recurringSeries)
		.innerJoin(reservation, eq(recurringSeries.prototypeId, reservation.id))
		.where(
			and(
				eq(recurringSeries.id, seriesId),
				eq(recurringSeries.prototypeType, 'reservation'),
				isNull(recurringSeries.cancelledAt),
				isNull(recurringSeries.supersededBy)
			)
		)
		.limit(1);
	if (!row) throw new RecurringSeriesError('Series not found or already cancelled');
	return row as ActiveSeries;
}

/** The old schedule ends on the club day the new one starts, not at its hour. */
function changeDay(schedule: NewSchedule): Date {
	const day = buildDateInTz(formatDateInTz(schedule.startsAt, TZ), '00:00', TZ);
	const now = new Date();
	return day > now ? day : now;
}

/** Old-schedule bookings from the change day on, split by whether they may go. */
async function oldBookings(series: ActiveSeries, from: Date) {
	const rows = await db
		.select({
			id: reservation.id,
			startsAt: reservation.startsAt,
			endsAt: reservation.endsAt,
			deletable: sql<number>`${deletable()}`.mapWith(Number)
		})
		.from(reservation)
		.where(
			and(
				eq(reservation.recurringSeriesId, series.id),
				gte(reservation.startsAt, from),
				inArray(reservation.status, LIVE_STATUSES)
			)
		)
		.orderBy(asc(reservation.startsAt));
	const removable = rows.filter((r) => r.deletable);
	const kept = rows.filter((r) => !r.deletable);
	return { removable, kept };
}

function checkShape(schedule: NewSchedule) {
	if (schedule.endsAt <= schedule.startsAt) {
		throw new RecurringSeriesError('End time must be after start time');
	}
	if (schedule.startsAt.getTime() <= Date.now()) {
		throw new RecurringSeriesError('The first session must be in the future');
	}
}

/**
 * What a schedule change would do: the new sessions the generation window
 * would hold, each with the conflict generation would meet, and the
 * old-schedule bookings it removes or keeps.
 */
export async function previewReschedule(
	seriesId: string,
	schedule: NewSchedule
): Promise<ReschedulePreview> {
	const series = await loadActive(seriesId);
	const rrule = buildRRule(schedule.startsAt, schedule.frequency, schedule.monthlyMode);
	// A requested session length, not a stored window: no tour is held in it.
	const { startsAt: first, endsAt: firstEnd } = schedule;
	const durationMs = firstEnd.getTime() - first.getTime();

	const window = await generationWindowEnd(new Date(), series.bookerType);
	let horizon = window > schedule.endsAt ? window : schedule.endsAt;
	if (schedule.until && schedule.until < horizon) horizon = schedule.until;
	const starts = getOccurrences(rrule, new Date(schedule.startsAt.getTime() - 1), horizon);

	const sessions: PlannedSession[] = [];
	for (const startsAt of starts.slice(0, 8)) {
		const endsAt = new Date(startsAt.getTime() + durationMs);
		const conflict = (await checkEventAndClosureConflict(startsAt, endsAt))
			? 'closed'
			: (await checkReservationConflict(startsAt, endsAt, series.id))
				? 'booked'
				: null;
		sessions.push({ startsAt, endsAt, conflict });
	}

	const { removable, kept } = await oldBookings(series, changeDay(schedule));
	return {
		sessions,
		kept: kept.map(({ id, startsAt, endsAt }) => ({ id, startsAt, endsAt })),
		removed: removable.length
	};
}

/**
 * Replaces a series with a new one on `schedule`. The old series is cancelled
 * and points at the new one through `supersededBy`. Its bookings before the
 * change day stand; from that day, an untouched booking is deleted and one
 * that is paid, has a door code or is referenced is kept for the booker to
 * keep or cancel, so no money moves here. The first session is the new
 * prototype, waitlisted behind a booking as generation would.
 */
export async function reschedule(
	seriesId: string,
	schedule: NewSchedule,
	by: SeriesCanceller
): Promise<RescheduleOutcome> {
	checkShape(schedule);
	const series = await loadActive(seriesId);

	// Staff book without the member window, as staffCreate does.
	if (by.kind !== 'staff') {
		const check = await validateBooking(schedule.startsAt, schedule.endsAt, {
			bookerType: series.bookerType,
			userId: series.createdByUserId,
			isRecurring: true
		});
		if (!check.valid) throw new RecurringSeriesError(check.error!);
	}
	const closed = await checkEventAndClosureConflict(schedule.startsAt, schedule.endsAt);
	if (closed) {
		throw new RecurringSeriesError(`The first session clashes with: ${closed.reason}`);
	}
	const waitlisted = await checkReservationConflict(schedule.startsAt, schedule.endsAt, series.id);

	const from = changeDay(schedule);
	const { removable, kept } = await oldBookings(series, from);

	const newId = crypto.randomUUID();
	const prototype = await insertReservation({
		bookerType: series.bookerType,
		bookerId: series.bookerId,
		createdByUserId: series.createdByUserId,
		createdByStaffId: by.kind === 'staff' ? by.userId : null,
		status: waitlisted ? 'waitlisted' : 'confirmed',
		startsAt: schedule.startsAt,
		endsAt: schedule.endsAt,
		notes: series.notes
	});

	const now = new Date();
	// The old prototype stays a row: the old series and its history point at it.
	const toDelete = removable.filter((r) => r.id !== series.prototypeId).map((r) => r.id);
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
			prototypeType: 'reservation',
			prototypeId: prototype.id,
			rrule: buildRRule(schedule.startsAt, schedule.frequency, schedule.monthlyMode),
			createdBy: series.createdByUserId,
			endsAt: schedule.until ?? null
		}),
		db
			.update(reservation)
			.set({ recurringSeriesId: newId, updatedAt: now })
			.where(eq(reservation.id, prototype.id)),
		// `deletable` is re-checked here, so a booking paid since the read is kept.
		db
			.delete(reservation)
			.where(
				and(
					inArray(reservation.id, toDelete),
					eq(reservation.recurringSeriesId, series.id),
					inArray(reservation.status, LIVE_STATUSES),
					deletable(),
					sql`EXISTS (SELECT 1 FROM ${recurringSeries} WHERE ${recurringSeries.id} = ${series.id} AND ${recurringSeries.supersededBy} = ${newId})`
				)
			)
			.returning({ id: reservation.id })
	]);
	if (getRowCount(superseded) === 0) {
		// Another request ended the series first; take back what this one wrote.
		await db.batch([
			db.delete(reservation).where(eq(reservation.id, prototype.id)),
			db.delete(recurringSeries).where(eq(recurringSeries.id, newId))
		]);
		throw new RecurringSeriesError('Series not found or already cancelled');
	}

	const outcome: RescheduleOutcome = {
		seriesId: newId,
		waitlisted,
		removed: deleted.map((r) => r.id),
		kept: [],
		errors: []
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

	const oldPrototype = removable.find((r) => r.id === series.prototypeId);
	if (oldPrototype) {
		const [userId, options] = cancelArgs(by);
		const ok = await attempt('cancel old prototype', () =>
			cancelReservation(oldPrototype.id, userId, RESCHEDULE_REASON, options)
		);
		if (ok) outcome.removed.push(oldPrototype.id);
	}
	const gone = new Set(outcome.removed);
	outcome.kept = [...kept, ...removable.filter((r) => !gone.has(r.id))]
		.map(({ id, startsAt, endsAt }) => ({ id, startsAt, endsAt }))
		.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

	if (!waitlisted) await attempt('announce', () => announceConfirmed(prototype.id));
	// A deleted booking emits no `reservation.cancelled`, so its slot is offered here.
	for (const row of removable.filter((r) => gone.has(r.id) && r !== oldPrototype)) {
		await attempt(`promote ${row.id}`, () => promoteNextWaitlisted(row.startsAt, row.endsAt));
	}
	await attempt('generate', () => generateSeries(newId));
	if (by.kind === 'staff') await attempt('notify', () => tellBooker(series, schedule, outcome));
	for (const msg of outcome.errors) console.error(`[recurring] reschedule ${seriesId}: ${msg}`);
	return outcome;
}

async function tellBooker(series: ActiveSeries, schedule: NewSchedule, outcome: RescheduleOutcome) {
	const [owner] = await db
		.select({ name: user.name, email: user.email })
		.from(user)
		.where(eq(user.id, series.createdByUserId))
		.limit(1);
	if (!owner) return;
	await domainEvents.emit('reservation.recurring_rescheduled', {
		seriesId: outcome.seriesId,
		userId: series.createdByUserId,
		userName: owner.name,
		userEmail: owner.email,
		date: formatDateInTz(schedule.startsAt, TZ),
		startTime: formatTimeInTz(schedule.startsAt, TZ),
		endTime: formatTimeInTz(schedule.endsAt, TZ),
		keptCount: outcome.kept.length
	});
}
