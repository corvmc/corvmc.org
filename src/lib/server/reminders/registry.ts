import { db } from '$lib/server/db';
import { reservation } from '$lib/server/db/schema/reservation';
import { user } from '$lib/server/db/schema/authentication';
import { eq, ne, and, gte, lt } from 'drizzle-orm';
import { formatDateFull, formatTimeSimple } from '$lib/server/reservation/timezone';
import { CONFIRMATION_WINDOW_DAYS, DEFAULT_TIMEZONE } from '$lib/config';
import {
	listSignupsStartingBetween,
	listCompletionsAwaitingFeedback
} from '$lib/server/volunteer/volunteer-signup-service';
import { defineReminder, type ReminderDefinition } from './types';

const TZ = DEFAULT_TIMEZONE;
const DAY = 24 * 60 * 60 * 1000;

/**
 * Reservations owed a reminder, by status and how far ahead they start.
 *
 * `event_listing` space is excluded from the confirmation ones: staff-held,
 * with no member confirm/pay flow to nag about.
 */
async function reservationsStartingWithin(
	status: 'scheduled' | 'confirmed',
	ms: number,
	now: Date
) {
	return db
		.select({
			id: reservation.id,
			startsAt: reservation.startsAt,
			endsAt: reservation.endsAt,
			userId: reservation.createdByUserId,
			userName: user.name,
			userEmail: user.email
		})
		.from(reservation)
		.innerJoin(user, eq(user.id, reservation.createdByUserId))
		.where(
			and(
				eq(reservation.status, status),
				...(status === 'scheduled' ? [ne(reservation.bookerType, 'event_listing')] : []),
				gte(reservation.startsAt, now),
				lt(reservation.startsAt, new Date(now.getTime() + ms))
			)
		)
		.limit(500);
}

const when = (row: { startsAt: Date; endsAt: Date }) => ({
	date: formatDateFull(row.startsAt, TZ),
	startTime: formatTimeSimple(row.startsAt, TZ),
	endTime: formatTimeSimple(row.endsAt, TZ)
});

/**
 * Every reminder the app sends, as anchor plus offset.
 *
 * Adding one is an entry here. It used to be a route file, a `schedule.ts`
 * entry, an `ALL_ENDPOINTS` entry, a service query and a fresh argument about
 * why the job fires once — and that last one is what #1123 was.
 */
export const reminders: ReminderDefinition[] = [
	// Two stages over one subject, so they carry different keys and each is sent
	// once. Before the mark they had to be non-overlapping bands on a job that
	// ran exactly daily, which is the constraint that made #1123 unfixable.
	defineReminder({
		key: 'reservation_confirmation_window_open',
		subjectType: 'reservation',
		event: 'reservation.confirmation_reminder_due',
		async due(now) {
			const rows = await reservationsStartingWithin(
				'scheduled',
				CONFIRMATION_WINDOW_DAYS * DAY,
				now
			);
			return rows.map((row) => ({
				subjectId: row.id,
				payload: {
					stage: 'window_open' as const,
					reservationId: row.id,
					userId: row.userId,
					userName: row.userName,
					userEmail: row.userEmail,
					...when(row)
				}
			}));
		}
	}),

	defineReminder({
		key: 'reservation_confirmation_final',
		subjectType: 'reservation',
		event: 'reservation.confirmation_reminder_due',
		async due(now) {
			const rows = await reservationsStartingWithin('scheduled', DAY, now);
			return rows.map((row) => ({
				subjectId: row.id,
				payload: {
					stage: 'final' as const,
					reservationId: row.id,
					userId: row.userId,
					userName: row.userName,
					userEmail: row.userEmail,
					...when(row)
				}
			}));
		}
	}),

	defineReminder({
		key: 'reservation_reminder',
		subjectType: 'reservation',
		event: 'reservation.reminder_due',
		async due(now) {
			const rows = await reservationsStartingWithin('confirmed', DAY, now);
			return rows.map((row) => ({
				subjectId: row.id,
				payload: {
					reservationId: row.id,
					userId: row.userId,
					userName: row.userName,
					userEmail: row.userEmail,
					...when(row)
				}
			}));
		}
	}),

	defineReminder({
		key: 'shift_reminder',
		subjectType: 'volunteer_signup',
		event: 'volunteer.shift_reminder_due',
		async due(now) {
			const rows = await listSignupsStartingBetween(now, new Date(now.getTime() + DAY));
			return rows.map((row) => ({
				subjectId: row.signupId,
				payload: {
					signupId: row.signupId,
					shiftId: row.shiftId,
					userId: row.userId,
					userName: row.userName,
					userEmail: row.userEmail,
					roleName: row.roleName,
					title: row.title,
					eventTitle: row.eventTitle,
					startsAt: row.startsAt.toISOString(),
					endsAt: row.endsAt.toISOString()
				}
			}));
		}
	}),

	// The window stays [48h ago, 24h ago). The mark makes it belt-and-braces
	// rather than load-bearing, but widening it would ask everybody whose shift
	// the floor newly covers, in one burst, on the first run.
	defineReminder({
		key: 'shift_feedback',
		subjectType: 'volunteer_signup',
		event: 'volunteer.shift_feedback_due',
		async due(now) {
			const rows = await listCompletionsAwaitingFeedback(
				new Date(now.getTime() - 2 * DAY),
				new Date(now.getTime() - DAY)
			);
			return rows.map((row) => ({
				subjectId: row.signupId,
				payload: {
					signupId: row.signupId,
					shiftId: row.shiftId,
					userId: row.userId,
					userName: row.userName,
					userEmail: row.userEmail,
					roleName: row.roleName,
					title: row.title,
					eventTitle: row.eventTitle,
					startsAt: row.startsAt.toISOString(),
					endsAt: row.endsAt.toISOString()
				}
			}));
		}
	})
];
