import { and, eq, ne } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { reservation, type TimeSlot } from '#lib/server/db/schema/reservation.js';
import { DEFAULT_TIMEZONE } from '#lib/config.js';
import { getReservationConfig, minSlotsFor } from './config';
import {
	bookableDateStrs,
	getAvailableSlotsForDates,
	isBookableStart,
	noticeFor,
	tourSlotsFor
} from './conflict-service';
import { buildDateInTz } from './timezone';

/** Starts the card prefers, half-open: 15:00 is in, 18:00 is out (last start 17:30). */
export const PEAK_START = '15:00';
export const PEAK_END = '18:00';
/** Open days offered, and the session length each one proposes. */
export const FIRST_BOOKING_SLOT_COUNT = 3;
export const FIRST_BOOKING_SESSION_MINUTES = 120;

export interface FirstBookingSlot {
	date: string;
	startTime: string;
	endTime: string;
	startsAt: Date;
	endsAt: Date;
}

type Window = { from: string; to: string } | null;

function pickIn(
	dates: string[],
	slotsByDate: Map<string, TimeSlot[]>,
	sessionSlots: number,
	tourSlots: number,
	window: Window,
	count: number
) {
	const picked: Pick<FirstBookingSlot, 'date' | 'startTime' | 'endTime'>[] = [];
	for (const date of dates) {
		if (picked.length >= count) break;
		const slots = slotsByDate.get(date) ?? [];
		const i = slots.findIndex(
			(s, idx) =>
				(!window || (s.startTime >= window.from && s.startTime < window.to)) &&
				isBookableStart(slots, idx, sessionSlots, tourSlots)
		);
		if (i === -1) continue;
		picked.push({
			date,
			startTime: slots[i].startTime,
			endTime: slots[i + sessionSlots - 1].endTime
		});
	}
	return picked;
}

/**
 * One session per day, the earliest start on each of the first `count` days
 * that has one. Peak starts first; with none in the window, any start.
 * Pure: `isBookableStart` checks the whole session and any tour before it.
 */
export function pickFirstBookingSlots(
	dates: string[],
	slotsByDate: Map<string, TimeSlot[]>,
	opts: { sessionSlots: number; tourSlots: number; count?: number }
) {
	const count = opts.count ?? FIRST_BOOKING_SLOT_COUNT;
	const peak = pickIn(
		dates,
		slotsByDate,
		opts.sessionSlots,
		opts.tourSlots,
		{
			from: PEAK_START,
			to: PEAK_END
		},
		count
	);
	return peak.length > 0
		? peak
		: pickIn(dates, slotsByDate, opts.sessionSlots, opts.tourSlots, null, count);
}

/**
 * Open sessions for a member's first booking, passed through the same notice,
 * tour, hours, closure and window rules the booking flow applies.
 */
export async function firstBookingSlots(userId: string): Promise<FirstBookingSlot[]> {
	const config = await getReservationConfig();
	const notice = await noticeFor(config, { userId, bookerType: 'user' });
	const dates = bookableDateStrs(config, 'user');
	const slotsByDate = await getAvailableSlotsForDates(dates, { minAdvanceMinutes: notice.minutes });

	const perHour = 60 / config.timeSlotMinutes;
	const sessionSlots = Math.min(
		Math.max(minSlotsFor('user', config), FIRST_BOOKING_SESSION_MINUTES / config.timeSlotMinutes),
		config.maxDurationHours * perHour
	);

	return pickFirstBookingSlots(dates, slotsByDate, {
		sessionSlots,
		tourSlots: tourSlotsFor(notice.tourMinutes, config)
	}).map((s) => ({
		...s,
		startsAt: buildDateInTz(s.date, s.startTime, DEFAULT_TIMEZONE),
		endsAt: buildDateInTz(s.date, s.endTime, DEFAULT_TIMEZONE)
	}));
}

/** Whether the member owns any reservation that is not cancelled (waitlisted counts). */
export async function hasBooked(userId: string): Promise<boolean> {
	const [row] = await db
		.select({ id: reservation.id })
		.from(reservation)
		.where(and(eq(reservation.createdByUserId, userId), ne(reservation.status, 'cancelled')))
		.limit(1);
	return row !== undefined;
}
