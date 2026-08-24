import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema/authentication';
import { reservation } from '$lib/server/db/schema/reservation';
import { band, bandMember } from '$lib/server/db/schema/band';
import { equipmentLoan } from '$lib/server/db/schema/equipment';
import { volunteerHourLog } from '$lib/server/db/schema/volunteer';
import { contentFlag } from '$lib/server/db/schema/flag';
import { paymentCache } from '$lib/server/db/schema/finance';
import { and, count, eq, gt, gte, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';

import { getAllBalances } from '$lib/server/finance/credit-service';
import { getMemberSubscription, mapDbSubscription } from '$lib/server/finance/subscription-service';
import { getStandings, type Standing } from '$lib/server/moderation/standing-service';
import type { StandingScope } from '$lib/config';
import { getUserHourSummary } from '$lib/server/volunteer/hour-log-service';
import { listForUser as listCertificationsForUser } from '$lib/server/volunteer/member-certification-service';
import { getVolunteerProfile, stageOf } from '$lib/server/volunteer/volunteer-profile-service';
import { isProfileComplete } from '$lib/server/directory/directory-service';
import { findByUserId as findSubscriberByUserId } from '$lib/server/marketing/subscriber-service';
import { countPortalUnread } from '$lib/server/inbox/portal-service';
import { getLastLoginAt } from './user-service';
import type { OnboardingStage } from '$lib/server/volunteer/volunteer-profile-service';

// ---------------------------------------------------------------------------
// User overview — one query behind the whole staff user record
// ---------------------------------------------------------------------------
//
// `/staff/users/[id]` is tabbed, and a tab's own queries only run once it is
// opened. That leaves one thing that cannot be lazy: the tab badges and the
// scoreboard, which have to be right on first paint or they are worse than
// absent. This is that data — every count the header, the badges and the
// Overview tab need, in a single round trip.
//
// It is deliberately all counts and single rows. The one exception is `bands`,
// which is a list because the membership rows are already being read to scope
// reservations and shows: the names come off a join that was happening anyway.
// Every other list belongs to a tab, which fetches it when someone looks.
//
// Every field here has a consumer. That is not a style note — the Overview tab
// used to carry a twelve-tile grid restating the size of each program, and the
// counts behind it were a third of the statements in this function. When the
// grid went, so did they: nothing should be computed on the critical path of
// every member view because it might be interesting.
// ---------------------------------------------------------------------------

export interface UserOverviewCounts {
	upcomingReservations: number;
	unpaidReservations: number;
	pendingBandInvites: number;
	overdueLoans: number;
	pendingHourLogs: number;
	approvedMinutesThisYear: number;
	certsNeedingAttention: number;
	unreadThreads: number;
	openFlagsAgainst: number;
	lifetimePaidCents: number;
}

export interface UserOverview {
	counts: UserOverviewCounts;
	/** Active and pending memberships alike — a never-accepted invite is a thing staff need to see. */
	bands: { id: string; name: string; status: string }[];
	credits: { free_hours: number; equipment_credits: number };
	membership: {
		sustaining: boolean;
		cancelAtPeriodEnd: boolean;
		creditsResetAt: Date | null;
		hoursPerReset: number | null;
	};
	/**
	 * Every scope at once. Kept as a record rather than a field per domain so
	 * adding a scope is a config change, not another pair of columns here — and
	 * so the caller loops rather than copy-pasting a block.
	 */
	standings: Record<StandingScope, Standing>;
	volunteer: { stage: OnboardingStage };
	marketing: { suppressed: boolean; suppressionReason: string | null };
	directory: { visibility: string; profileComplete: boolean };
	lastLoginAt: Date | null;
}

export async function getUserOverview(userId: string): Promise<UserOverview> {
	const now = new Date();

	// Band membership is resolved first: reservations key off it, and it is one
	// small query rather than a subquery repeated. The band name rides along for
	// free — the join to `band` was already there to filter out deleted ones.
	const [memberships, account] = await Promise.all([
		db
			.select({ bandId: bandMember.bandId, name: band.name, status: bandMember.status })
			.from(bandMember)
			.innerJoin(band, eq(band.id, bandMember.bandId))
			.where(and(eq(bandMember.userId, userId), isNull(band.deletedAt))),
		db
			.select({ directoryVisibility: user.directoryVisibility })
			.from(user)
			.where(eq(user.id, userId))
			.limit(1)
	]);

	const activeBandIds = memberships.filter((m) => m.status === 'active').map((m) => m.bandId);
	const pendingBandInvites = memberships.filter((m) => m.status === 'pending').length;

	// Theirs = booked by them, or by a band they are actively in. Event bookings
	// are the venue's, not the member's, and are excluded everywhere.
	const mine = eq(reservation.createdByUserId, userId);
	const scope = and(
		activeBandIds.length > 0
			? or(
					mine,
					and(eq(reservation.bookerType, 'band'), inArray(reservation.bookerId, activeBandIds))
				)!
			: mine,
		ne(reservation.bookerType, 'event')
	)!;

	const scalar = async (q: Promise<{ count: number }[]>) => (await q)[0]?.count ?? 0;

	const [
		upcomingReservations,
		unpaidReservations,
		overdueLoans,
		pendingHourLogs,
		openFlagsAgainst,
		paymentsAgg,
		credits,
		dbSubscription,
		standings,
		hourSummary,
		certifications,
		volunteerProfile,
		profileComplete,
		subscriber,
		unreadThreads,
		lastLoginAt
	] = await Promise.all([
		scalar(
			db
				.select({ count: count() })
				.from(reservation)
				.where(and(scope, gte(reservation.endsAt, now)))
		),
		scalar(
			db
				.select({ count: count() })
				.from(reservation)
				.where(
					and(
						scope,
						ne(reservation.status, 'cancelled'),
						gt(reservation.cashDueCents, 0),
						isNull(reservation.paidAt)
					)
				)
		),
		scalar(
			db
				.select({ count: count() })
				.from(equipmentLoan)
				.where(
					and(
						eq(equipmentLoan.userId, userId),
						eq(equipmentLoan.status, 'checked_out'),
						lt(equipmentLoan.dueDate, now)
					)
				)
		),
		scalar(
			db
				.select({ count: count() })
				.from(volunteerHourLog)
				.where(and(eq(volunteerHourLog.userId, userId), eq(volunteerHourLog.status, 'pending')))
		),
		scalar(
			db
				.select({ count: count() })
				.from(contentFlag)
				.where(
					and(
						eq(contentFlag.entityType, 'member_profile'),
						eq(contentFlag.entityId, userId),
						eq(contentFlag.status, 'pending')
					)
				)
		),
		db
			.select({
				cents: sql<number>`coalesce(sum(case when ${paymentCache.status} = 'succeeded' then ${paymentCache.amountCents} else 0 end), 0)`
			})
			.from(paymentCache)
			.where(eq(paymentCache.userId, userId)),
		getAllBalances(userId),
		getMemberSubscription(userId),
		getStandings(userId),
		getUserHourSummary(userId),
		listCertificationsForUser(userId),
		getVolunteerProfile(userId),
		isProfileComplete(userId),
		findSubscriberByUserId(userId),
		countPortalUnread(userId),
		getLastLoginAt(userId)
	]);

	const subscription = mapDbSubscription(dbSubscription);
	const held = certifications.filter((c) => !c.revokedAt);

	return {
		counts: {
			upcomingReservations,
			unpaidReservations,
			pendingBandInvites,
			overdueLoans,
			pendingHourLogs,
			approvedMinutesThisYear: hourSummary.approvedMinutesThisYear,
			// "Needs attention" is expiring-or-expired, not revoked: a revoked
			// clearance was an intentional act and is already resolved.
			certsNeedingAttention: held.filter((c) => c.state === 'expiring' || c.state === 'expired')
				.length,
			unreadThreads,
			openFlagsAgainst,
			lifetimePaidCents: Number(paymentsAgg[0]?.cents ?? 0)
		},
		bands: memberships.map((m) => ({ id: m.bandId, name: m.name, status: m.status })),
		credits: {
			free_hours: credits.free_hours ?? 0,
			equipment_credits: credits.equipment_credits ?? 0
		},
		membership: {
			sustaining: dbSubscription != null,
			cancelAtPeriodEnd: dbSubscription?.cancelAtPeriodEnd ?? false,
			creditsResetAt: subscription?.currentPeriodEnd ?? null,
			hoursPerReset: dbSubscription?.hoursPerReset ?? null
		},
		standings,
		volunteer: { stage: stageOf(volunteerProfile) },
		marketing: {
			suppressed: subscriber?.suppressedAt != null,
			suppressionReason: subscriber?.suppressionReason ?? null
		},
		directory: {
			visibility: account[0]?.directoryVisibility ?? 'members',
			profileComplete
		},
		lastLoginAt
	};
}

export type { UserOverview as StaffUserOverview };
