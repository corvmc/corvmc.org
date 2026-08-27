import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { reservation } from '$lib/server/db/schema/reservation';
import { user } from '$lib/server/db/schema/authentication';
import { eq, ne, and, gte, lt } from 'drizzle-orm';
import { domainEvents } from '$lib/server/event-bus/event-bus';
import { formatDateFull, formatTimeSimple } from '$lib/server/reservation/timezone';
import { DEFAULT_TIMEZONE } from '$lib/config';

const TZ = DEFAULT_TIMEZONE;

/**
 * Cron endpoint for sending confirmation reminders.
 * Queries reservations in 'scheduled' (unconfirmed) status starting in the
 * next 24 hours and emits a confirmation reminder event for each. Space booked
 * for an event is excluded — it is staff-held, with no member confirm/pay flow
 * to nag the staff creator about.
 *
 * Schedule: daily at 09:00 AM Pacific
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
	const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

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
				ne(reservation.bookerType, 'event'),
				gte(reservation.startsAt, now),
				lt(reservation.startsAt, in24h)
			)
		)
		.limit(500);

	let emitted = 0;
	for (const row of rows) {
		try {
			await domainEvents.emit('reservation.confirmation_reminder_due', {
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
