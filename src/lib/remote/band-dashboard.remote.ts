import { z } from 'zod';
import { and, eq, gte } from 'drizzle-orm';
import { query } from '$app/server';
import { form } from './_remote';
import { db } from '#lib/server/db/index.js';
import { reservation } from '#lib/server/db/schema/reservation.js';
import { requireGroupRole } from '#lib/server/group/group-context.js';
import {
	dismissInviteStep as dismissInviteStepService,
	getMembers,
	isInviteStepDismissed,
	partitionByStatus
} from '#lib/server/band/band-service.js';
import { listForGroup as listEmailInvites } from '#lib/server/group/group-invite-service.js';
import { listBandEvents } from '#lib/server/event/event-service.js';
import { countGroupInboxUnread } from '#lib/server/inbox/unified-service.js';
import { bandSetupSteps, bandTodos, bandUpcoming } from '#lib/server/band/band-dashboard.js';
import { isAwaitingPayment, reservationTrack } from '#lib/utils/reservation-actions.js';
import { splitUpcoming } from '#lib/utils/upcoming.js';
import { getPressKitProgress } from './press-kit.remote';

/** How many reservations and events the Upcoming card lists before its links. */
const UPCOMING_LIMIT = 6;

/**
 * The band dashboard's one load-bearing query (#3128): what the band owes or
 * has to answer, what is coming up, and setup. Owner and admin rows (invites,
 * enquiries, drafts, setup, press kit) are read only for them; the guard is
 * `requireGroupRole`, as on every band-panel read.
 */
export const getBandDashboard = query(z.string(), async (bandId) => {
	const {
		user: viewer,
		group: band,
		role
	} = await requireGroupRole({ id: bandId }, 'member', { staff: 'band.read' });
	const canManage = role === 'owner' || role === 'admin';
	const now = new Date();
	const bookedByBand = and(eq(reservation.bookerType, 'group'), eq(reservation.bookerId, band.id));

	const [
		reservations,
		[anyReservation],
		events,
		unread,
		members,
		emailInvites,
		pressKit,
		inviteDismissed
	] = await Promise.all([
		db
			.select({
				id: reservation.id,
				status: reservation.status,
				startsAt: reservation.startsAt,
				endsAt: reservation.endsAt,
				bookerType: reservation.bookerType,
				paidAt: reservation.paidAt,
				refundedAt: reservation.refundedAt,
				cashDueCents: reservation.cashDueCents
			})
			.from(reservation)
			// Upcoming until the slot ends, the rule every reservation list uses.
			.where(and(bookedByBand, gte(reservation.endsAt, now)))
			.orderBy(reservation.startsAt),
		db.select({ id: reservation.id }).from(reservation).where(bookedByBand).limit(1),
		listBandEvents(band.id),
		canManage ? countGroupInboxUnread(viewer.id, band.id) : { chat: 0, enquiries: 0 },
		canManage ? getMembers(band.id) : [],
		canManage ? listEmailInvites(band.id) : [],
		canManage ? getPressKitProgress(band.slug) : null,
		canManage ? isInviteStepDismissed(band.id) : false
	]);

	const upcomingEvents = splitUpcoming(events, now).upcoming;
	const roster = partitionByStatus(members);
	const pendingMembers = roster.pending.map((m) => m.member.title);
	const pendingEmails = emailInvites.filter((i) => i.status === 'pending').map((i) => i.email);

	const todos = bandTodos({
		slug: band.slug,
		// Any member may pay what the band owes (#2095); staff take payment elsewhere.
		unpaid: role === 'staff' ? [] : reservations.filter(isAwaitingPayment),
		unreadEnquiries: unread.enquiries,
		invitees: [...pendingMembers, ...pendingEmails],
		drafts: upcomingEvents.filter((e) => e.isOwner && e.status === 'draft')
	});

	const upcoming = bandUpcoming(
		band.slug,
		reservations.map((r) => ({ ...r, status: reservationTrack(r, now) })),
		upcomingEvents,
		UPCOMING_LIMIT
	);

	const steps = bandSetupSteps({
		slug: band.slug,
		memberCount: roster.active.length,
		// Every invite ever sent, answered or not: sending is the band's step.
		invitesSent: roster.pending.length + emailInvites.length,
		inviteDismissed,
		hasReservation: !!anyReservation,
		hasProfile: !!pressKit?.sections
			.filter((s) => s.key === 'identity' || s.key === 'bio')
			.every((s) => s.done),
		hasEvent: events.length > 0
	});
	// Setup until its four steps are done, then the press kit until it is.
	const setup = canManage && steps.some((s) => !s.done) ? steps : null;

	return {
		canManage,
		todos,
		upcoming,
		setup,
		pressKit: canManage && !setup && pressKit?.next ? pressKit : null
	};
});

/** A one-person project dismisses the invite setup step (#3127). Owner or admin. */
export const dismissInviteStep = form(z.object({ slug: z.string().min(1) }), async (data) => {
	const { group: band } = await requireGroupRole({ slug: data.slug }, 'admin');
	await dismissInviteStepService(band.id);
	return { success: true };
});
