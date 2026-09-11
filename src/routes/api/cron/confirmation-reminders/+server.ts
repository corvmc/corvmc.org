import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { reservation } from '$lib/server/db/schema/reservation';
import { user } from '$lib/server/db/schema/authentication';
import { eq, ne, and, gte, lt, or } from 'drizzle-orm';
import { domainEvents } from '$lib/server/event-bus/event-bus';
import { formatDateFull, formatTimeSimple } from '$lib/server/reservation/timezone';
import { CONFIRMATION_WINDOW_DAYS, DEFAULT_TIMEZONE } from '$lib/config';

const TZ = DEFAULT_TIMEZONE;

/**
 * Cron endpoint for sending confirmation reminders.
 *
 * Twice, not once. Confirming opens `CONFIRMATION_WINDOW_DAYS` before the
 * start, and this only ever swept the last 24 hours of it — so two of the
 * three days a member could act passed in silence (#965). The second band
 * catches a booking on the day its window opens. Space booked for an event is
 * excluded: staff-held, with no member confirm/pay flow to nag about.
 *
 * One run a day is what keeps each band a single send — neither is bounded by
 * a "reminded already" mark, so they must not overlap and the job must not run
 * twice in a day. Schedule: daily at 09:00 AM Pacific.
 *   POST /api/cron/confirmation-reminders
 *   Authorization: Bearer <CRON_SECRET>
 */
export const POST: RequestHandler = async ({ request }) => {
	const secret = env.CRON_SECRET;
	if (!secret) throw error(500, 'CRON_SECRET not configured');

	const auth = request.headers.get('Authorization');
	if (auth !== `Bearer ${secret}`) {
		throw error(401, 'Unauthorized');
	}

	const now = new Date();
	const DAY = 24 * 60 * 60 * 1000;
	const in24h = new Date(now.getTime() + DAY);
	// The day the window opens, as a band a daily run crosses exactly once.
	const windowOpensFrom = new Date(now.getTime() + (CONFIRMATION_WINDOW_DAYS - 1) * DAY);
	const windowOpensTo = new Date(now.getTime() + CONFIRMATION_WINDOW_DAYS * DAY);

	const rows = await db
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
				eq(reservation.status, 'scheduled'),
				ne(reservation.bookerType, 'event_listing'),
				or(
					and(gte(reservation.startsAt, now), lt(reservation.startsAt, in24h)),
					and(gte(reservation.startsAt, windowOpensFrom), lt(reservation.startsAt, windowOpensTo))
				)
			)
		)
		.limit(500);

	let emitted = 0;
	for (const row of rows) {
		try {
			await domainEvents.emit('reservation.confirmation_reminder_due', {
				// Which of the two bands caught it, so the copy can say "you can
				// confirm now" rather than "it is tomorrow" three days out.
				stage: row.startsAt >= windowOpensFrom ? 'window_open' : 'final',
				reservationId: row.id,
				userId: row.userId,
				userName: row.userName,
				userEmail: row.userEmail,
				date: formatDateFull(row.startsAt, TZ),
				startTime: formatTimeSimple(row.startsAt, TZ),
				endTime: formatTimeSimple(row.endsAt, TZ)
			});
			emitted++;
		} catch (err) {
			console.error(`[cron] confirmation-reminder failed for ${row.id}:`, err);
		}
	}

	return json({ found: rows.length, emitted });
};
