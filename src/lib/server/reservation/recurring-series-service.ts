import { db, getRowCount } from '$lib/server/db';
import { recurringSeries } from '$lib/server/db/schema/recurring';
import { reservation } from '$lib/server/db/schema/reservation';
import { event } from '$lib/server/db/schema/event';
import { user } from '$lib/server/db/schema/authentication';
import { band } from '$lib/server/db/schema/band';

/**
 * `bookerId` points at a band only when `bookerType` says so, so the type check
 * belongs in the join — without it a band whose id happened to match a user's
 * would attach to the wrong row. Mirrors `reservations.remote.ts`.
 */
const bandBookerJoin = and(eq(reservation.bookerType, 'band'), eq(band.id, reservation.bookerId));
const eventBookerJoin = and(
	eq(reservation.bookerType, 'event'),
	eq(event.id, reservation.bookerId)
);
import { eq, and, isNull, sql, count } from 'drizzle-orm';
import { paginate, type PaginationInput } from '$lib/server/db/paginate';
import {
	bandRefColumns,
	eventRefColumns,
	memberRefColumns,
	toBookerRef
} from '$lib/server/entity/refs';
import type { EntityRef } from '$lib/types/entity';
import { buildRRule, describeFrequency, monthlyModeOf, type MonthlyMode } from './rrule-helpers';
import type { RecurringFrequency } from '$lib/server/db/schema/recurring';

// ---------------------------------------------------------------------------
// RecurringSeriesService — create, cancel, and query recurring series
// ---------------------------------------------------------------------------

export class RecurringSeriesError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'RecurringSeriesError';
	}
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateSeriesParams {
	/** The prototype reservation that was just created */
	prototypeReservationId: string;
	/** Recurrence frequency */
	frequency: RecurringFrequency;
	/** The prototype's startsAt — used to derive RRULE DTSTART and BYDAY */
	prototypeStartsAt: Date;
	/** For monthly series: repeat on the nth weekday (default) or a fixed day of the month */
	monthlyMode?: MonthlyMode;
	/** Optional scheduled end date for the series */
	endsAt?: Date;
}

export interface SeriesRow {
	id: string;
	supersededBy: string | null;
	prototypeType: string;
	prototypeId: string;
	rrule: string;
	createdAt: Date;
	endsAt: Date | null;
	cancelledAt: Date | null;
}

export interface SeriesWithPrototype extends SeriesRow {
	prototypeName: string;
	prototypeBookerType: string;
	prototypeBookerId: string;
	prototypeCreatedByUserId: string;
	prototypeStartsAt: Date;
	prototypeEndsAt: Date;
	prototypeNotes: string | null;
}

export interface SeriesListItem {
	id: string;
	rrule: string;
	frequencyLabel: string;
	monthlyMode: MonthlyMode | null;
	createdAt: Date;
	seriesEndsAt: Date | null;
	cancelledAt: Date | null;
	/**
	 * Who the series is *for* — a member, a band or an event, exactly as on the
	 * bookings it generates. `createdBy` is who set it up, which is not the same
	 * question and lives on the detail page.
	 */
	booker: EntityRef;
	bookerType: string;
	bookerId: string;
	startsAt: Date;
	endsAt: Date;
}

// ---------------------------------------------------------------------------
// create() — link a new series to a prototype reservation
// ---------------------------------------------------------------------------

export async function create(params: CreateSeriesParams): Promise<SeriesRow> {
	const { prototypeReservationId, frequency, prototypeStartsAt, endsAt } = params;

	const [proto] = await db
		.select({ createdByUserId: reservation.createdByUserId })
		.from(reservation)
		.where(eq(reservation.id, prototypeReservationId))
		.limit(1);
	if (!proto) throw new RecurringSeriesError('Prototype reservation not found');

	const rruleString = buildRRule(prototypeStartsAt, frequency, params.monthlyMode ?? 'weekday');

	const seriesId = crypto.randomUUID();

	await db.batch([
		db.insert(recurringSeries).values({
			id: seriesId,
			prototypeType: 'reservation',
			prototypeId: prototypeReservationId,
			rrule: rruleString,
			createdBy: proto.createdByUserId,
			endsAt: endsAt ?? null
		}),
		db
			.update(reservation)
			.set({ recurringSeriesId: seriesId, updatedAt: new Date() })
			.where(eq(reservation.id, prototypeReservationId))
	]);

	const [series] = await db.select().from(recurringSeries).where(eq(recurringSeries.id, seriesId));
	return series;
}

// ---------------------------------------------------------------------------
// createEventSeries() — link a new series to a prototype event
// ---------------------------------------------------------------------------

export interface CreateEventSeriesParams {
	/** The prototype event that was just created */
	prototypeEventId: string;
	/** Recurrence frequency */
	frequency: RecurringFrequency;
	/** The prototype's startsAt — used to derive the recurrence rule */
	prototypeStartsAt: Date;
	/** For monthly series: repeat on the nth weekday (default) or a fixed day of the month */
	monthlyMode?: MonthlyMode;
	/** Optional scheduled end date for the series */
	endsAt?: Date;
}

export async function createEventSeries(params: CreateEventSeriesParams): Promise<SeriesRow> {
	const { prototypeEventId, frequency, prototypeStartsAt, endsAt } = params;

	const [proto] = await db
		.select({ createdByUserId: event.createdByUserId })
		.from(event)
		.where(eq(event.id, prototypeEventId))
		.limit(1);
	if (!proto) throw new RecurringSeriesError('Prototype event not found');

	const rruleString = buildRRule(prototypeStartsAt, frequency, params.monthlyMode ?? 'weekday');

	const seriesId = crypto.randomUUID();

	await db.batch([
		db.insert(recurringSeries).values({
			id: seriesId,
			prototypeType: 'event',
			prototypeId: prototypeEventId,
			rrule: rruleString,
			createdBy: proto.createdByUserId,
			endsAt: endsAt ?? null
		}),
		db
			.update(event)
			.set({ recurringSeriesId: seriesId, updatedAt: new Date() })
			.where(eq(event.id, prototypeEventId))
	]);

	const [series] = await db.select().from(recurringSeries).where(eq(recurringSeries.id, seriesId));
	return series;
}

// ---------------------------------------------------------------------------
// cancel() — stop a series from generating new instances
// ---------------------------------------------------------------------------

export async function cancel(seriesId: string): Promise<void> {
	const result = await db
		.update(recurringSeries)
		.set({ cancelledAt: new Date() })
		.where(
			and(
				eq(recurringSeries.id, seriesId),
				isNull(recurringSeries.cancelledAt),
				isNull(recurringSeries.supersededBy)
			)
		);

	if (getRowCount(result) === 0) {
		throw new RecurringSeriesError('Series not found or already cancelled');
	}
}

// ---------------------------------------------------------------------------
// cancelAllForUser() — cancel all active series for a user (subscription lapse)
// ---------------------------------------------------------------------------

export async function cancelAllForUser(userId: string): Promise<number> {
	const now = new Date();

	const result = await db
		.update(recurringSeries)
		.set({ cancelledAt: now })
		.where(
			and(
				eq(recurringSeries.prototypeType, 'reservation'),
				isNull(recurringSeries.cancelledAt),
				isNull(recurringSeries.supersededBy),
				sql`${recurringSeries.prototypeId} IN (
					SELECT ${reservation.id} FROM ${reservation}
					WHERE ${reservation.createdByUserId} = ${userId}
				)`
			)
		);

	return getRowCount(result);
}

// ---------------------------------------------------------------------------
// get() — single series with prototype details
// ---------------------------------------------------------------------------

export async function get(seriesId: string): Promise<SeriesWithPrototype | null> {
	const rows = await db
		.select({
			id: recurringSeries.id,
			supersededBy: recurringSeries.supersededBy,
			prototypeType: recurringSeries.prototypeType,
			prototypeId: recurringSeries.prototypeId,
			rrule: recurringSeries.rrule,
			createdAt: recurringSeries.createdAt,
			endsAt: recurringSeries.endsAt,
			cancelledAt: recurringSeries.cancelledAt,
			prototypeName: user.name,
			prototypeBookerType: reservation.bookerType,
			prototypeBookerId: reservation.bookerId,
			prototypeCreatedByUserId: reservation.createdByUserId,
			prototypeStartsAt: reservation.startsAt,
			prototypeEndsAt: reservation.endsAt,
			prototypeNotes: reservation.notes
		})
		.from(recurringSeries)
		.innerJoin(reservation, eq(recurringSeries.prototypeId, reservation.id))
		.innerJoin(user, eq(reservation.createdByUserId, user.id))
		.where(eq(recurringSeries.id, seriesId))
		.limit(1);

	return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// getByReservation() — find the series a reservation belongs to
// ---------------------------------------------------------------------------

export async function getByReservation(reservationId: string): Promise<SeriesRow | null> {
	const rows = await db
		.select({
			id: recurringSeries.id,
			supersededBy: recurringSeries.supersededBy,
			prototypeType: recurringSeries.prototypeType,
			prototypeId: recurringSeries.prototypeId,
			rrule: recurringSeries.rrule,
			createdAt: recurringSeries.createdAt,
			endsAt: recurringSeries.endsAt,
			cancelledAt: recurringSeries.cancelledAt
		})
		.from(recurringSeries)
		.innerJoin(reservation, eq(reservation.recurringSeriesId, recurringSeries.id))
		.where(eq(reservation.id, reservationId))
		.limit(1);

	return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// getByEvent() — find the series an event belongs to
// ---------------------------------------------------------------------------

export async function getByEvent(eventId: string): Promise<SeriesRow | null> {
	const rows = await db
		.select({
			id: recurringSeries.id,
			supersededBy: recurringSeries.supersededBy,
			prototypeType: recurringSeries.prototypeType,
			prototypeId: recurringSeries.prototypeId,
			rrule: recurringSeries.rrule,
			createdAt: recurringSeries.createdAt,
			endsAt: recurringSeries.endsAt,
			cancelledAt: recurringSeries.cancelledAt
		})
		.from(recurringSeries)
		.innerJoin(event, eq(event.recurringSeriesId, recurringSeries.id))
		.where(eq(event.id, eventId))
		.limit(1);

	return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// getEventSeries() — single event series with prototype details
// ---------------------------------------------------------------------------

export interface EventSeriesWithPrototype extends SeriesRow {
	frequencyLabel: string;
	monthlyMode: MonthlyMode | null;
	prototypeEventId: string;
	prototypeTitle: string;
	prototypeStartsAt: Date;
	prototypeCreatedByUserId: string;
}

export async function getEventSeries(seriesId: string): Promise<EventSeriesWithPrototype | null> {
	const rows = await db
		.select({
			id: recurringSeries.id,
			supersededBy: recurringSeries.supersededBy,
			prototypeType: recurringSeries.prototypeType,
			prototypeId: recurringSeries.prototypeId,
			rrule: recurringSeries.rrule,
			createdAt: recurringSeries.createdAt,
			endsAt: recurringSeries.endsAt,
			cancelledAt: recurringSeries.cancelledAt,
			prototypeEventId: event.id,
			prototypeTitle: event.title,
			prototypeStartsAt: event.startsAt,
			prototypeCreatedByUserId: event.createdByUserId
		})
		.from(recurringSeries)
		.innerJoin(event, eq(recurringSeries.prototypeId, event.id))
		.where(eq(recurringSeries.id, seriesId))
		.limit(1);

	const row = rows[0];
	if (!row) return null;

	return {
		...row,
		frequencyLabel: describeFrequency(row.rrule),
		monthlyMode: monthlyModeOf(row.rrule)
	};
}

// ---------------------------------------------------------------------------
// listActive() — all active series (staff view)
// ---------------------------------------------------------------------------

export async function listActive(opts?: { forUser?: string }): Promise<SeriesListItem[]> {
	const conditions = [
		eq(recurringSeries.prototypeType, 'reservation'),
		isNull(recurringSeries.cancelledAt),
		isNull(recurringSeries.supersededBy)
	];

	if (opts?.forUser) {
		conditions.push(eq(recurringSeries.createdBy, opts.forUser));
	}

	const rows = await db
		.select({
			id: recurringSeries.id,
			rrule: recurringSeries.rrule,
			createdAt: recurringSeries.createdAt,
			seriesEndsAt: recurringSeries.endsAt,
			cancelledAt: recurringSeries.cancelledAt,
			member: memberRefColumns(),
			band: bandRefColumns(),
			event: eventRefColumns(),
			bookerType: reservation.bookerType,
			bookerId: reservation.bookerId,
			startsAt: reservation.startsAt,
			endsAt: reservation.endsAt
		})
		.from(recurringSeries)
		.innerJoin(reservation, eq(recurringSeries.prototypeId, reservation.id))
		.innerJoin(user, eq(reservation.createdByUserId, user.id))
		.leftJoin(band, bandBookerJoin)
		.leftJoin(event, eventBookerJoin)
		.where(and(...conditions));

	return rows.map(({ member, band: bandRow, event: eventRow, ...r }) => ({
		...r,
		booker: toBookerRef({ bookerType: r.bookerType, member, band: bandRow, event: eventRow }),
		frequencyLabel: describeFrequency(r.rrule),
		monthlyMode: monthlyModeOf(r.rrule)
	}));
}

// ---------------------------------------------------------------------------
// listAll() — all series including cancelled (staff view with filters)
// ---------------------------------------------------------------------------

export async function listAll(opts?: { filter?: string }, pagination: PaginationInput = {}) {
	const conditions = [
		eq(recurringSeries.prototypeType, 'reservation'),
		isNull(recurringSeries.supersededBy)
	];

	if (opts?.filter === 'active') {
		conditions.push(isNull(recurringSeries.cancelledAt));
	} else if (opts?.filter === 'cancelled') {
		conditions.push(sql`${recurringSeries.cancelledAt} is not null`);
	}

	const where = and(...conditions);

	const dataQ = db
		.select({
			id: recurringSeries.id,
			rrule: recurringSeries.rrule,
			createdAt: recurringSeries.createdAt,
			seriesEndsAt: recurringSeries.endsAt,
			cancelledAt: recurringSeries.cancelledAt,
			member: memberRefColumns(),
			band: bandRefColumns(),
			event: eventRefColumns(),
			bookerType: reservation.bookerType,
			bookerId: reservation.bookerId,
			startsAt: reservation.startsAt,
			endsAt: reservation.endsAt
		})
		.from(recurringSeries)
		.innerJoin(reservation, eq(recurringSeries.prototypeId, reservation.id))
		.innerJoin(user, eq(reservation.createdByUserId, user.id))
		.leftJoin(band, bandBookerJoin)
		.leftJoin(event, eventBookerJoin)
		.where(where)
		.$dynamic();

	const countQ = db
		.select({ count: count() })
		.from(recurringSeries)
		.innerJoin(reservation, eq(recurringSeries.prototypeId, reservation.id))
		.where(where);

	const result = await paginate(dataQ, countQ, pagination);
	return {
		...result,
		rows: result.rows.map(({ member, band: bandRow, event: eventRow, ...r }) => ({
			...r,
			booker: toBookerRef({ bookerType: r.bookerType, member, band: bandRow, event: eventRow }),
			frequencyLabel: describeFrequency(r.rrule),
			monthlyMode: monthlyModeOf(r.rrule)
		}))
	};
}

// ---------------------------------------------------------------------------
// getHistory() — follow the superseded_by chain for a series
// ---------------------------------------------------------------------------

export async function getHistory(seriesId: string): Promise<SeriesRow[]> {
	// Walk backward from the given series — find predecessors that point to it
	const history: SeriesRow[] = [];

	// First, get the given series
	const [current] = await db
		.select()
		.from(recurringSeries)
		.where(eq(recurringSeries.id, seriesId))
		.limit(1);

	if (!current) return [];
	history.push(current);

	// Walk backwards: find series whose supersededBy points to entries we already have
	// This is a simple iterative approach — chains are short in practice
	let predecessorId = seriesId;
	for (let i = 0; i < 50; i++) {
		const [pred] = await db
			.select()
			.from(recurringSeries)
			.where(eq(recurringSeries.supersededBy, predecessorId))
			.limit(1);

		if (!pred) break;
		history.unshift(pred); // prepend — oldest first
		predecessorId = pred.id;
	}

	// Walk forward from the current: follow supersededBy pointers
	let nextId = current.supersededBy;
	for (let i = 0; i < 50; i++) {
		if (!nextId) break;
		const [next] = await db
			.select()
			.from(recurringSeries)
			.where(eq(recurringSeries.id, nextId))
			.limit(1);

		if (!next) break;
		history.push(next);
		nextId = next.supersededBy;
	}

	return history;
}
