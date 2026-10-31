import { and, asc, count, desc, eq, gt, gte, inArray, lt, lte, ne, not, sql } from 'drizzle-orm';
import { clubToday, DEFAULT_TIMEZONE } from '$lib/config';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema/authentication';
import { reservation } from '$lib/server/db/schema/reservation';
import { eventListing } from '$lib/server/db/schema/event';
import { production } from '$lib/server/db/schema/production';
import { group } from '$lib/server/db/schema/group';
import { venue } from '$lib/server/db/schema/venue';
import {
	bandRefColumns,
	eventRefColumns,
	memberRefColumns,
	toBookerRef,
	toMemberRef,
	toEventRef
} from '$lib/server/entity/refs';
import { bandBookerJoin, eventBookerJoin } from '$lib/server/reservation/event-hold';
import { buildDateInTz, nextDay } from '$lib/server/reservation/timezone';
import { isInAccessWindow } from '$lib/server/lock/fallback-code-service';
import { eventPosterKeySql } from '$lib/server/event/event-columns';
import { showBlockers } from '$lib/server/event/show-readiness';

/** How far ahead the dashboard's show list reads. */
export const DASHBOARD_SHOW_HORIZON_DAYS = 7;

const startOfClubDay = (date: string) => buildDateInTz(date, '00:00', DEFAULT_TIMEZONE);

/**
 * Every booking and hold touching today or tomorrow in club time, grouped by
 * day. A booking that crosses midnight appears on both days.
 */
export async function listRoomDays(now = new Date()) {
	const today = clubToday(now);
	const tomorrow = nextDay(today);
	const days = [today, tomorrow].map((date) => ({
		date,
		from: startOfClubDay(date),
		to: startOfClubDay(nextDay(date))
	}));

	const rows = await db
		.select({
			id: reservation.id,
			status: reservation.status,
			startsAt: reservation.startsAt,
			endsAt: reservation.endsAt,
			bookerType: reservation.bookerType,
			lockCode: reservation.lockCode,
			lockSyncedAt: reservation.lockSyncedAt,
			member: memberRefColumns(),
			band: bandRefColumns(),
			event: eventRefColumns()
		})
		.from(reservation)
		.innerJoin(user, eq(reservation.createdByUserId, user.id))
		.leftJoin(group, bandBookerJoin())
		.leftJoin(eventListing, eventBookerJoin())
		.where(
			and(
				ne(reservation.status, 'cancelled'),
				lt(reservation.startsAt, days[1].to),
				gt(reservation.endsAt, days[0].from)
			)
		)
		.orderBy(asc(reservation.startsAt));

	const items = rows.map(({ member, band, event, lockCode, lockSyncedAt, ...r }) => ({
		...r,
		booker: toBookerRef({ bookerType: r.bookerType, member, band, event }),
		// A code the lock has not reported back opens nothing (#780); the digits stay off this page.
		doorCodeUnconfirmed:
			r.status === 'confirmed' && !!lockCode && !lockSyncedAt && isInAccessWindow(r, now)
	}));

	return days.map(({ date, from, to }) => ({
		date,
		reservations: items.filter((r) => r.startsAt < to && r.endsAt > from)
	}));
}

/** Who joined this club-time month, and the latest few to join at all. */
export async function listMemberSummary(now = new Date(), recent = 5) {
	const monthStart = startOfClubDay(`${clubToday(now).slice(0, 8)}01`);
	const [[joined], latest] = await Promise.all([
		db.select({ value: count() }).from(user).where(gte(user.createdAt, monthStart)),
		db
			.select({ member: memberRefColumns(), createdAt: user.createdAt })
			.from(user)
			.orderBy(desc(user.createdAt), desc(user.id))
			.limit(recent)
	]);
	return {
		newThisMonth: joined.value,
		recent: latest.map((u) => ({
			id: u.member.id,
			createdAt: u.createdAt,
			ref: toMemberRef(u.member)
		}))
	};
}

/**
 * Listings starting in the next week that staff may see, with what each CMC show
 * still lacks. A member's private draft stays out, as on every staff list.
 */
export async function listUpcomingShows(now = new Date(), days = DASHBOARD_SHOW_HORIZON_DAYS) {
	const from = startOfClubDay(clubToday(now));
	const to = new Date(from.getTime() + days * 86_400_000);

	const rows = await db
		.select({
			id: eventListing.id,
			title: eventListing.title,
			startsAt: eventListing.startsAt,
			endsAt: eventListing.endsAt,
			status: eventListing.status,
			source: eventListing.source,
			description: eventListing.description,
			posterKey: eventPosterKeySql,
			venueName: venue.name,
			productionStatus: production.status,
			actsWanted: production.actsWanted,
			actsBilled: sql<number>`(SELECT count(*) FROM "event_band" "eb"
				WHERE "eb"."event_id" = "event_listing"."id")`
		})
		.from(eventListing)
		.leftJoin(venue, eq(venue.id, eventListing.venueId))
		.leftJoin(production, eq(production.projectId, eventListing.projectId))
		.where(
			and(
				gte(eventListing.startsAt, from),
				lte(eventListing.startsAt, to),
				inArray(eventListing.status, ['draft', 'pending_review', 'published']),
				not(and(eq(eventListing.source, 'community'), eq(eventListing.status, 'draft'))!)
			)
		)
		.orderBy(asc(eventListing.startsAt));

	return rows.map((r) => {
		const short = r.actsWanted == null ? 0 : Math.max(0, r.actsWanted - r.actsBilled);
		const blockers = showBlockers(r);
		if (r.source === 'cmc' && short > 0) {
			blockers.push(`the bill needs ${short} more ${short === 1 ? 'band' : 'bands'}`);
		}
		return {
			id: r.id,
			ref: toEventRef({ id: r.id, title: r.title, startsAt: r.startsAt }),
			startsAt: r.startsAt,
			endsAt: r.endsAt,
			status: r.status,
			source: r.source,
			venueName: r.venueName,
			productionStatus: r.productionStatus,
			blockers
		};
	});
}
