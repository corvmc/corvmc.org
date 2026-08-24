import { z } from 'zod';
import { error, redirect, invalid } from '@sveltejs/kit';
import { query, form, getRequestEvent } from '$app/server';
import { db } from '$lib/server/db';
import { user, type Subscription } from '$lib/server/db/schema/authentication';
import {
	reservation,
	type Reservation,
	reservationStatuses,
	type ReservationStatus
} from '$lib/server/db/schema/reservation';
import { createReservationSchema } from '$lib/server/db/schema/reservation';
import {
	like,
	or,
	eq,
	ne,
	and,
	lt,
	gt,
	gte,
	lte,
	inArray,
	notInArray,
	sql,
	isNull,
	asc,
	desc,
	count
} from 'drizzle-orm';
import { getById as getBandById } from '$lib/server/band/band-service';
import { band } from '$lib/server/db/schema/band';
import { event } from '$lib/server/db/schema/event';
import { formatDateInTz, buildDateInTz } from '$lib/server/reservation/timezone';
import { describeFrequency, monthlyModeOf } from '$lib/server/reservation/rrule-helpers';
import { isStaff, requireStaff, requireStaffOrOwner, requireUser } from '$lib/server/authorization';
import {
	bandRefColumns,
	eventRefColumns,
	memberRefColumns,
	reservationRefColumns,
	toBandRef,
	toBookerRef,
	toMemberRef,
	toReservationRef
} from '$lib/server/entity/refs';
import {
	getAvailableSlots,
	getConflictDetails,
	getValidationWarnings
} from '$lib/server/reservation/conflict-service';
import {
	staffCreate,
	create,
	createWaitlisted,
	cancel,
	confirm,
	markComplete,
	markNoShow,
	recordCashAndComplete,
	ReservationConflictError,
	ReservationValidationError
} from '$lib/server/reservation/reservation-service';
import { mapDomainError } from '$lib/server/errors';
import { isTerminalStatus } from '$lib/utils/reservation-actions';
import { getReservationConfig } from '$lib/server/reservation/config';
import { config } from '$lib/server/site-config/site-config-service';
import type { CheckoutLineItem } from '$lib/server/finance/payment-service';
import {
	checkout,
	recordCashPayment,
	refund as refundPayment
} from '$lib/server/finance/payment-service';
import { getBalance } from '$lib/server/finance/credit-service';
import {
	commitReservationCredits,
	computeReservationCredit,
	reverseReservationCredits
} from '$lib/server/reservation/reservation-credit-service';
import { ensureStripeCustomer } from '$lib/server/finance/stripe-customer-service';
import {
	RECURRING_FREQUENCIES,
	recurringSeries,
	type RecurringFrequency
} from '$lib/server/db/schema/recurring';
import { formatSlotTime } from '$lib/utils/format';
import { buildRRule, getOccurrences } from '$lib/server/reservation/rrule-helpers';
import {
	create as createSeries,
	listActive as listActiveSeries
} from '$lib/server/reservation/recurring-series-service';
import { getMembers } from '$lib/server/band/band-service';
import { requireBandMember, requireBandMemberOrStaff } from '$lib/server/band/band-context';
import { paginate } from '$lib/server/db/paginate';
import { ensureContactPhone } from '$lib/server/user/user-service';
import { PHONE_REQUIRED_MESSAGE, isValidPhone } from '$lib/utils/phone';
import {
	DEFAULT_TIMEZONE,
	SEARCH_LIMIT,
	LIST_LIMIT,
	CONFIRMATION_WINDOW_DAYS,
	withinConfirmationWindow
} from '$lib/config';

// ===========================================================================
// Queries
// ===========================================================================

export const getReservationPayment = query(z.string(), async (id) => {
	const currentUser = requireUser();

	const [row] = await db.select().from(reservation).where(eq(reservation.id, id)).limit(1);

	if (!row) throw error(404, 'Reservation not found');
	if (row.createdByUserId !== currentUser.id) throw error(403, 'Not your reservation');
	// Payable: awaiting confirmation, or already confirmed with a balance still
	// owed ("cash at door" bookings can settle online too). cashDueCents null on
	// a confirmed row means credits were never committed — still owed in full.
	const confirmedUnpaid =
		row.status === 'confirmed' && !row.paidAt && (row.cashDueCents == null || row.cashDueCents > 0);
	if (row.status !== 'scheduled' && !confirmedUnpaid)
		throw error(400, 'This reservation is not awaiting payment');

	const hourlyRateCents = await config<number>('reservation.hourlyRateCents');
	const durationMs = row.endsAt.getTime() - row.startsAt.getTime();
	const durationHours = durationMs / (1000 * 60 * 60);
	const totalCents = Math.round(durationHours * hourlyRateCents);
	const freeHoursBalance = await getBalance(currentUser.id, 'free_hours');

	return {
		reservation: {
			id: row.id,
			startsAt: row.startsAt,
			endsAt: row.endsAt,
			notes: row.notes
		},
		durationHours,
		totalCents,
		hourlyRateCents,
		freeHoursBalance,
		// Committed settlement state — when cashDueCents is non-null the credits
		// are locked in and the page must show the stored remainder, not a
		// re-projection from the live balance.
		cashDueCents: row.cashDueCents,
		creditsUsedHours: row.creditsUsed
	};
});

/**
 * Owner-only detail view for a single reservation — backs the member detail
 * page that gets linked in communications (and surfaces the door code).
 */
export const getReservationDetail = query(z.string(), async (id) => {
	const currentUser = requireUser();

	const [row] = await db.select().from(reservation).where(eq(reservation.id, id)).limit(1);

	if (!row) throw error(404, 'Reservation not found');
	if (row.createdByUserId !== currentUser.id) throw error(403, 'Not your reservation');

	const hourlyRateCents = await config<number>('reservation.hourlyRateCents');
	const durationHours = (row.endsAt.getTime() - row.startsAt.getTime()) / (1000 * 60 * 60);
	const totalCents = Math.round(durationHours * hourlyRateCents);

	return {
		reservation: row,
		durationHours,
		totalCents,
		hourlyRateCents
	};
});

export const getBandReservations = query(z.string(), async (slug) => {
	// A bare `requireUser()` here meant any signed-in account could read any
	// band's practice schedule, the name of whoever booked each session, and the
	// notes on it, just by passing that band's slug — which matters more now the
	// feature is on for everyone rather than flag-gated off. The read-side guard
	// rather than `requireBandMember()`: staff administer band panels, and the
	// layout already lets them in, so the member-only guard would 403 them into
	// the error boundary. The slug cross-check is what stops the guard's band
	// (from `params.slug`) and the requested one from diverging.
	const { user: currentUser, band, role } = await requireBandMemberOrStaff();
	if (band.slug !== slug) error(403, 'Not authorized');

	const now = new Date();
	// Whether the viewer may cancel each row. `cancel()` authorizes on
	// `createdByUserId`, so a bandmate who didn't book cannot — the page used to
	// render Cancel on every row regardless and answered with an error toast.
	// Band admins may cancel any of their band's sessions; everyone else only
	// their own. Computed here because the client cannot be trusted to.
	const bandAdmin = role === 'owner' || role === 'admin';
	const canCancelRow = (createdByUserId: string) => bandAdmin || createdByUserId === currentUser.id;

	const upcoming = await db
		.select({
			id: reservation.id,
			status: reservation.status,
			startsAt: reservation.startsAt,
			endsAt: reservation.endsAt,
			notes: reservation.notes,
			ref: reservationRefColumns(),
			// Who booked it for the band. The `user` join is already here.
			bookedBy: memberRefColumns(),
			// Not for display — `canCancel` below is derived from it.
			createdByUserId: reservation.createdByUserId
		})
		.from(reservation)
		.leftJoin(user, eq(user.id, reservation.createdByUserId))
		.where(
			and(
				eq(reservation.bookerType, 'band'),
				eq(reservation.bookerId, band.id),
				gt(reservation.startsAt, now),
				ne(reservation.status, 'cancelled')
			)
		)
		.orderBy(reservation.startsAt);

	const past = await db
		.select({
			id: reservation.id,
			status: reservation.status,
			startsAt: reservation.startsAt,
			endsAt: reservation.endsAt,
			notes: reservation.notes,
			ref: reservationRefColumns(),
			// Who booked it for the band. The `user` join is already here.
			bookedBy: memberRefColumns(),
			// Not for display — `canCancel` below is derived from it.
			createdByUserId: reservation.createdByUserId
		})
		.from(reservation)
		.leftJoin(user, eq(user.id, reservation.createdByUserId))
		.where(
			and(
				eq(reservation.bookerType, 'band'),
				eq(reservation.bookerId, band.id),
				lte(reservation.startsAt, now)
			)
		)
		.orderBy(desc(reservation.startsAt))
		.limit(SEARCH_LIMIT);

	const withBooker = (r: (typeof upcoming)[number], cancellable: boolean) => ({
		...r,
		ref: toReservationRef(r.ref, band),
		bookedBy: toMemberRef(r.bookedBy),
		canCancel: cancellable && canCancelRow(r.createdByUserId)
	});
	return {
		upcoming: upcoming.map((r) => withBooker(r, true)),
		// A session that has already happened is nobody's to cancel.
		past: past.map((r) => withBooker(r, false))
	};
});

export const getStaffReservationDetail = query(z.string(), async (id) => {
	await requireStaff();

	const rows = await db
		.select({
			reservation: reservation,
			member: memberRefColumns(),
			memberPhone: user.phone,
			bandId: band.id,
			bandName: band.name,
			bandSlug: band.slug,
			eventId: event.id,
			eventTitle: event.title
		})
		.from(reservation)
		.innerJoin(user, eq(reservation.createdByUserId, user.id))
		.leftJoin(band, bandBookerJoin)
		.leftJoin(event, eventBookerJoin)
		.where(eq(reservation.id, id))
		.limit(1);

	if (!rows[0]) throw error(404, 'Reservation not found');

	// Audit: who at the front desk created this booking, if it wasn't the member.
	let createdByStaffName: string | null = null;
	if (rows[0].reservation.createdByStaffId) {
		const [staffRow] = await db
			.select({ name: user.name })
			.from(user)
			.where(eq(user.id, rows[0].reservation.createdByStaffId))
			.limit(1);
		createdByStaffName = staffRow?.name ?? null;
	}

	const row = {
		...rows[0].reservation,
		member: toMemberRef(rows[0].member),
		// The two contact affordances the identity strip takes as props. Email is
		// also the ref's subline, but the strip renders contact instead of it.
		memberEmail: rows[0].member.email,
		memberPhone: rows[0].memberPhone,
		bandId: rows[0].bandId,
		bandName: rows[0].bandName,
		bandSlug: rows[0].bandSlug,
		eventId: rows[0].eventId,
		eventTitle: rows[0].eventTitle,
		// The booking band as a record. `bandId`/`bandName` stay for the header
		// action and the page title, which are not references.
		band: rows[0].bandId
			? toBandRef({ id: rows[0].bandId, name: rows[0].bandName, slug: rows[0].bandSlug })
			: null,
		// Who the room is held for — a band, a show, or the member themselves.
		// The list column and this page then lead with the same record.
		booker: toBookerRef({
			bookerType: rows[0].reservation.bookerType,
			member: rows[0].member,
			band: { id: rows[0].bandId, name: rows[0].bandName, slug: rows[0].bandSlug },
			event: { id: rows[0].eventId, title: rows[0].eventTitle }
		}),
		createdByStaffName
	};

	const tz = DEFAULT_TIMEZONE;
	const dayStr = formatDateInTz(row.startsAt, tz);
	const dayStart = buildDateInTz(dayStr, '00:00', tz);
	const dayEnd = buildDateInTz(dayStr, '23:59', tz);

	const sameDayReservations = await db
		.select({
			id: reservation.id,
			bookerType: reservation.bookerType,
			startsAt: reservation.startsAt,
			endsAt: reservation.endsAt,
			status: reservation.status
		})
		.from(reservation)
		.where(
			and(
				ne(reservation.status, 'cancelled'),
				ne(reservation.id, id),
				lt(reservation.startsAt, dayEnd),
				gt(reservation.endsAt, dayStart)
			)
		)
		.orderBy(asc(reservation.startsAt));

	const isLastOfDay =
		sameDayReservations.filter((r) => r.startsAt.getTime() > row.startsAt.getTime()).length === 0;

	const [prevRow] = await db
		.select({ id: reservation.id })
		.from(reservation)
		.where(and(ne(reservation.status, 'cancelled'), lt(reservation.startsAt, row.startsAt)))
		.orderBy(desc(reservation.startsAt))
		.limit(1);

	const [nextRow] = await db
		.select({ id: reservation.id })
		.from(reservation)
		.where(and(ne(reservation.status, 'cancelled'), gt(reservation.startsAt, row.startsAt)))
		.orderBy(asc(reservation.startsAt))
		.limit(1);

	const [completedCount] = await db
		.select({ count: count() })
		.from(reservation)
		.where(
			and(eq(reservation.createdByUserId, row.createdByUserId), eq(reservation.status, 'completed'))
		);

	return {
		reservation: row,
		sameDayReservations: sameDayReservations.map((r) => ({
			id: r.id,
			memberName: '',
			bookerType: r.bookerType,
			startsAt: r.startsAt,
			endsAt: r.endsAt,
			status: r.status
		})),
		isLastOfDay,
		prevId: prevRow?.id ?? null,
		nextId: nextRow?.id ?? null,
		isFirstReservation: completedCount.count === 0,
		hourlyRateCents: await config<number>('reservation.hourlyRateCents')
	};
});

/** Staff: search members by name or email for the create-reservation modal. */
export const searchMembers = query(z.string(), async (q) => {
	await requireStaff();
	if (!q || q.length < 2) return [];

	const pattern = `%${q}%`;
	const results = await db
		.select({ id: user.id, name: user.name, email: user.email })
		.from(user)
		.where(or(like(user.name, pattern), like(user.email, pattern)))
		.limit(SEARCH_LIMIT);

	return results;
});

/** Staff: band lookup for booking on a band's behalf. */
export const searchBands = query(z.string(), async (q) => {
	await requireStaff();
	if (!q || q.length < 2) return [];

	const pattern = `%${q}%`;
	return db
		.select({
			id: band.id,
			name: band.name,
			ownerId: band.ownerId,
			ownerName: user.name,
			ownerEmail: user.email
		})
		.from(band)
		.innerJoin(user, eq(user.id, band.ownerId))
		.where(and(isNull(band.deletedAt), like(band.name, pattern)))
		.limit(SEARCH_LIMIT);
});

/** Staff: available slots + config for a given date. */
export const getStaffSlots = query(z.string(), async (dateParam) => {
	await requireStaff();
	const dateStr = dateParam || formatDateInTz(new Date(), DEFAULT_TIMEZONE);
	const [slots, reservationConfig] = await Promise.all([
		getAvailableSlots(dateStr),
		getReservationConfig()
	]);

	return {
		date: dateStr,
		slots,
		config: {
			hourlyRateCents: reservationConfig.hourlyRateCents,
			slotMinutes: reservationConfig.timeSlotMinutes,
			minDurationHours: reservationConfig.minDurationHours,
			maxDurationHours: reservationConfig.maxDurationHours
		}
	};
});

/** Member: dates with bookable availability in the next N days. */
export const getAvailableDates = query(async () => {
	const config = await getReservationConfig();
	const minSlots = config.minDurationHours * (60 / config.timeSlotMinutes);
	// Floor, not ceil: the validator (validateBooking) rejects any start *instant*
	// more than `maxAdvanceDaysOneoff * 24h` past now. A whole calendar day is only
	// fully bookable when its latest instant is still within that window, i.e. up to
	// offset `floor(maxAdvanceDays) - 1`. Using ceil could offer a day whose later
	// slots exceed a fractional limit (e.g. 14.5), recreating the "dead zone" where
	// the picker shows a date that then 500s on Book & Pay.
	const days = Math.floor(config.maxAdvanceDaysOneoff);
	const tz = DEFAULT_TIMEZONE;
	const todayStr = formatDateInTz(new Date(), tz);

	const results: string[] = [];
	// Offer today (i=0) through today + (days - 1). Stopping at `i < days` keeps the
	// last offered day strictly inside the window, so every one of its slots validates.
	for (let i = 0; i < days; i++) {
		// Advance the calendar date by `i` days without relying on runtime-local
		// Date math: anchor noon-LA of today, step in whole days, re-read in LA.
		const anchor = buildDateInTz(todayStr, '12:00', tz);
		const dateStr = formatDateInTz(new Date(anchor.getTime() + i * 86_400_000), tz);
		const slots = await getAvailableSlots(dateStr);

		let maxRun = 0;
		let run = 0;
		for (const s of slots) {
			if (s.available) {
				run++;
				if (run > maxRun) maxRun = run;
			} else {
				run = 0;
			}
		}
		if (maxRun >= minSlots) results.push(dateStr);
	}
	return results;
});

/**
 * Member: available slots + config + recurring frequencies for a given date.
 * Deliberately unguarded — returns only which slots are free plus public
 * booking config, never who booked them.
 */
export const getMemberSlots = query(z.string(), async (dateParam) => {
	const dateStr = dateParam || formatDateInTz(new Date(), DEFAULT_TIMEZONE);
	const [slots, reservationConfig] = await Promise.all([
		getAvailableSlots(dateStr),
		getReservationConfig()
	]);

	return {
		date: dateStr,
		slots,
		recurringFrequencies: RECURRING_FREQUENCIES,
		config: {
			hourlyRateCents: reservationConfig.hourlyRateCents,
			slotMinutes: reservationConfig.timeSlotMinutes,
			minDurationHours: reservationConfig.minDurationHours,
			maxDurationHours: reservationConfig.maxDurationHours
		}
	};
});

/** Available start times for a given date, with pricing config. */
export const getReservationStartTimes = query(z.string(), async (dateParam) => {
	const dateStr = dateParam || formatDateInTz(new Date(), DEFAULT_TIMEZONE);
	const [slots, reservationConfig] = await Promise.all([
		getAvailableSlots(dateStr),
		getReservationConfig()
	]);

	const minSlots = reservationConfig.minDurationHours * (60 / reservationConfig.timeSlotMinutes);

	function contiguousFrom(startIdx: number): number {
		let count = 0;
		for (let i = startIdx; i < slots.length && slots[i].available; i++) count++;
		return count;
	}

	const options = slots
		.filter((s, i) => s.available && contiguousFrom(i) >= minSlots)
		.map((s) => ({ value: s.startTime, label: formatSlotTime(s.startTime) }));

	return options;
});

/** Available end times for a given date and start time. */
export const getReservationEndTimes = query(
	z.object({ date: z.string(), startTime: z.string() }),
	async ({ date: dateParam, startTime }) => {
		const dateStr = dateParam || formatDateInTz(new Date(), DEFAULT_TIMEZONE);
		const [slots, reservationConfig] = await Promise.all([
			getAvailableSlots(dateStr),
			getReservationConfig()
		]);

		const slotMinutes = reservationConfig.timeSlotMinutes;
		const minSlots = reservationConfig.minDurationHours * (60 / slotMinutes);
		const maxSlots = reservationConfig.maxDurationHours * (60 / slotMinutes);

		const startIdx = slots.findIndex((s) => s.startTime === startTime);
		if (startIdx === -1) return [];

		let run = 0;
		for (let i = startIdx; i < slots.length && slots[i].available; i++) run++;
		const cap = Math.min(run, maxSlots);

		const options: { value: string; label: string }[] = [];
		for (let i = 0; i < cap; i++) {
			if (i + 1 >= minSlots) {
				const t = slots[startIdx + i].endTime;
				options.push({ value: t, label: formatSlotTime(t) });
			}
		}
		return options;
	}
);

/** Member: full pricing breakdown for a given date/time selection. */
export const getReservationPricing = query(
	z.object({
		date: z.string(),
		startTime: z.string(),
		endTime: z.string(),
		// When confirming an existing reservation, pricing must reflect the
		// reservation OWNER's free hours / sustaining status — not the acting user
		// (e.g. a staff member confirming on the owner's behalf). Omitted by the
		// create flow, which has no reservation yet and keys to the acting user.
		reservationId: z.string().optional()
	}),
	async ({ date, startTime, endTime, reservationId }) => {
		const { locals } = getRequestEvent();
		const config = await getReservationConfig();

		// Duration from real timestamps — the same arithmetic booking and
		// settlement use — so the quote can't diverge from the charge on a
		// DST-transition day (wall-clock minute subtraction would).
		const startsAt = buildDateInTz(date, startTime, DEFAULT_TIMEZONE);
		const endsAt = buildDateInTz(date, endTime, DEFAULT_TIMEZONE);
		const durationHours = (endsAt.getTime() - startsAt.getTime()) / (1000 * 60 * 60);

		const hourlyRateCents = config.hourlyRateCents;
		const totalCents = Math.round(durationHours * hourlyRateCents);

		// Resolve whose free hours apply. For an existing reservation, that's the
		// owner — staff or the owner themselves may view it.
		let targetUserId = locals.user?.id ?? null;
		if (reservationId) {
			const [res] = await db
				.select({ createdByUserId: reservation.createdByUserId })
				.from(reservation)
				.where(eq(reservation.id, reservationId))
				.limit(1);
			if (!res) throw error(404, 'Reservation not found');
			const isOwner = locals.user?.id === res.createdByUserId;
			const staff = locals.user ? await isStaff(locals.user.id) : false;
			if (!isOwner && !staff) throw error(403, 'Not authorized');
			targetUserId = res.createdByUserId;
		}

		const freeHoursBalance = targetUserId ? await getBalance(targetUserId, 'free_hours') : 0;

		let isSustainingMember = false;
		if (targetUserId) {
			const [row] = await db
				.select({ subscription: user.subscription })
				.from(user)
				.where(eq(user.id, targetUserId))
				.limit(1);
			isSustainingMember = row?.subscription != null;
		}

		// Single source of truth shared with settlement (commitReservationCredits)
		// so the member is never shown a different remainder than they're charged.
		const { creditUnits, creditDiscountCents, remainingCents } = computeReservationCredit({
			totalCents,
			durationHours,
			hourlyRateCents,
			freeHoursBalance
		});

		return {
			durationHours,
			hourlyRateCents,
			totalCents,
			freeHoursBalance,
			creditsApplicable: creditUnits,
			creditDiscountCents,
			remainingCents,
			isSustainingMember
		};
	}
);

/** Recurring: all operating-hour time slots (no per-date availability filtering). */
export const getRecurringTimeSlots = query(async () => {
	const cfg = await getReservationConfig();
	const slotMinutes = cfg.timeSlotMinutes;
	const [startH, startM] = cfg.operatingHoursStart.split(':').map(Number);
	const [endH, endM] = cfg.operatingHoursEnd.split(':').map(Number);

	const startSlots: { value: string; label: string }[] = [];
	const allSlots: string[] = [];

	for (let m = startH * 60 + startM; m < endH * 60 + endM; m += slotMinutes) {
		const hh = String(Math.floor(m / 60)).padStart(2, '0');
		const mm = String(m % 60).padStart(2, '0');
		const time = `${hh}:${mm}`;
		allSlots.push(time);
	}
	// Add the closing time as a valid end time
	allSlots.push(cfg.operatingHoursEnd);

	const minSlots = cfg.minDurationHours * (60 / slotMinutes);
	// Start times must leave room for at least minDuration
	for (let i = 0; i < allSlots.length - minSlots; i++) {
		startSlots.push({ value: allSlots[i], label: formatSlotTime(allSlots[i]) });
	}

	return {
		startSlots,
		allSlots: allSlots.map((t) => ({ value: t, label: formatSlotTime(t) })),
		config: {
			slotMinutes,
			minDurationHours: cfg.minDurationHours,
			maxDurationHours: cfg.maxDurationHours
		}
	};
});

/**
 * Recurring: preview upcoming instances for a given schedule.
 * Deliberately unguarded — pure date arithmetic over caller-supplied input,
 * reads no stored data.
 */
export const previewRecurringInstances = query(
	z.object({
		date: z.string(),
		startTime: z.string(),
		frequency: z.enum(['weekly', 'biweekly', 'monthly']),
		monthlyMode: z.enum(['weekday', 'monthday']).optional()
	}),
	async ({ date, startTime, frequency, monthlyMode }) => {
		const startsAt = buildDateInTz(date, startTime, DEFAULT_TIMEZONE);
		const rruleString = buildRRule(
			startsAt,
			frequency as RecurringFrequency,
			monthlyMode ?? 'weekday'
		);
		const now = new Date();
		// Show ~60 days of preview
		const windowEnd = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
		const occurrences = getOccurrences(rruleString, now, windowEnd);
		return {
			dates: occurrences.slice(0, 8).map((d) => d.toISOString()),
			totalInWindow: occurrences.length
		};
	}
);

/** Staff: check conflicts for a given date/time range. */
export const checkConflicts = query(
	z.object({ date: z.string(), startTime: z.string(), endTime: z.string() }),
	async ({ date, startTime, endTime }) => {
		await requireStaff();
		const startsAt = buildDateInTz(date, startTime, DEFAULT_TIMEZONE);
		const endsAt = buildDateInTz(date, endTime, DEFAULT_TIMEZONE);

		const conflicts = await getConflictDetails(startsAt, endsAt);
		const validationWarnings = await getValidationWarnings(startsAt, endsAt);

		return { conflicts, validationWarnings };
	}
);

/**
 * Booking policy facts for the info strip — live config, so staff changes to
 * `reservation.*` site-config show up instead of drifting from hard-coded copy.
 */
export const getReservationPolicy = query(async () => {
	const reservationConfig = await getReservationConfig();
	return {
		hourlyRateCents: reservationConfig.hourlyRateCents,
		operatingHoursStart: reservationConfig.operatingHoursStart,
		operatingHoursEnd: reservationConfig.operatingHoursEnd,
		minDurationHours: reservationConfig.minDurationHours,
		maxDurationHours: reservationConfig.maxDurationHours,
		minAdvanceMinutes: reservationConfig.minAdvanceMinutes
	};
});

/**
 * Member: the contact number on file, so the booking forms know whether to ask
 * for one. Kept separate from getMembershipStatus so it can be refreshed on its
 * own once a booking has saved a number.
 */
export const getBookingContact = query(async () => {
	const currentUser = requireUser();

	const [row] = await db
		.select({ phone: user.phone })
		.from(user)
		.where(eq(user.id, currentUser.id))
		.limit(1);

	return { phone: row?.phone ?? null, needsPhone: !isValidPhone(row?.phone) };
});

/** Member: subscription status — called once per page load. */
export const getMembershipStatus = query(async () => {
	const { locals } = getRequestEvent();
	if (!locals.user)
		return {
			isSustainingMember: false,
			freeHoursBalance: 0,
			creditsResetAt: null,
			hoursPerReset: 0
		};

	const [row] = await db
		.select({ subscription: user.subscription })
		.from(user)
		.where(eq(user.id, locals.user.id))
		.limit(1);

	const freeHoursBalance = await getBalance(locals.user.id, 'free_hours');
	const sub = row?.subscription as Subscription | null;

	return {
		isSustainingMember: sub != null,
		freeHoursBalance,
		creditsResetAt: sub?.creditsResetAt ?? null,
		hoursPerReset: sub?.hoursPerReset ?? 0
	};
});

/** Band: check if any active band member has a sustaining membership. */
export const getBandMembershipStatus = query(z.void(), async () => {
	const { band } = await requireBandMember();
	const members = await getMembers(band.id);
	const activeUserIds = members.filter((m) => m.status === 'active').map((m) => m.userId);

	if (activeUserIds.length === 0) return { hasSustainingMember: false };

	const [sustaining] = await db
		.select({ id: user.id })
		.from(user)
		.where(and(inArray(user.id, activeUserIds), sql`subscription is not null`))
		.limit(1);

	return { hasSustainingMember: sustaining != null };
});

// ===========================================================================
// Queries — staff reservations
// ===========================================================================

const staffReservationFiltersSchema = z.object({
	tab: z.enum(['upcoming', 'all']).optional(),
	search: z.string().optional(),
	dateFrom: z.string().optional(),
	dateTo: z.string().optional(),
	statusFilter: z.array(z.string()).optional(),
	bookerType: z.enum(['user', 'band', 'event']).optional(),
	page: z.number().optional()
});

/**
 * `bookerId` points at a band only when `bookerType` is `band`, so the join has
 * to carry that discriminator — otherwise a band whose id happened to match a
 * user's would attach to the wrong row.
 */
const bandBookerJoin = and(eq(reservation.bookerType, 'band'), eq(band.id, reservation.bookerId));

/** The same shape for the other polymorphic booker: an event holding the room. */
const eventBookerJoin = and(
	eq(reservation.bookerType, 'event'),
	eq(event.id, reservation.bookerId)
);

/** Staff: paginated, filtered reservation list. */
export const getStaffReservations = query(staffReservationFiltersSchema, async (filters) => {
	await requireStaff();

	const now = new Date();
	const tab = filters.tab ?? 'upcoming';
	const conditions = [];

	if (tab === 'upcoming') {
		conditions.push(gt(reservation.endsAt, now));
		conditions.push(ne(reservation.status, 'cancelled'));
	}

	if (filters.statusFilter && filters.statusFilter.length > 0) {
		const valid = filters.statusFilter.filter((s): s is ReservationStatus =>
			(reservationStatuses as readonly string[]).includes(s)
		);
		if (valid.length > 0) conditions.push(inArray(reservation.status, valid));
	}

	// Day bounds anchored to the app timezone (a bare `new Date(...)` parses in
	// the runtime zone — UTC on Workers — shifting the window vs the LA-anchored
	// data). Same pattern as credit-service listTransactions.
	if (filters.dateFrom) {
		conditions.push(
			gte(reservation.startsAt, buildDateInTz(filters.dateFrom, '00:00', DEFAULT_TIMEZONE))
		);
	}
	if (filters.dateTo) {
		conditions.push(
			lte(reservation.startsAt, buildDateInTz(filters.dateTo, '23:59', DEFAULT_TIMEZONE))
		);
	}

	if (filters.bookerType) {
		conditions.push(eq(reservation.bookerType, filters.bookerType));
	}

	if (filters.search) {
		const pattern = `%${filters.search}%`;
		conditions.push(
			or(
				like(user.name, pattern),
				like(user.email, pattern),
				like(band.name, pattern),
				like(event.title, pattern)
			)
		);
	}

	const where = conditions.length > 0 ? and(...conditions) : undefined;

	const dataQ = db
		.select({
			id: reservation.id,
			status: reservation.status,
			startsAt: reservation.startsAt,
			endsAt: reservation.endsAt,
			bookerType: reservation.bookerType,
			notes: reservation.notes,
			stripePaymentRecordId: reservation.stripePaymentRecordId,
			paidAt: reservation.paidAt,
			cashDueCents: reservation.cashDueCents,
			creditsUsed: reservation.creditsUsed,
			createdByUserId: reservation.createdByUserId,
			recurringSeriesId: reservation.recurringSeriesId,
			// Three joins for one column: the booker is a member, a band or an
			// event, and which one it is comes from `bookerType`.
			member: memberRefColumns(),
			band: bandRefColumns(),
			event: eventRefColumns()
		})
		.from(reservation)
		.innerJoin(user, eq(reservation.createdByUserId, user.id))
		.leftJoin(band, bandBookerJoin)
		.leftJoin(event, eventBookerJoin)
		.where(where)
		.orderBy(tab === 'upcoming' ? asc(reservation.startsAt) : desc(reservation.startsAt))
		.$dynamic();

	const countQ = db
		.select({ count: count() })
		.from(reservation)
		.innerJoin(user, eq(reservation.createdByUserId, user.id))
		.leftJoin(band, bandBookerJoin)
		.leftJoin(event, eventBookerJoin)
		.where(where);

	const { rows, pagination } = await paginate(dataQ, countQ, {
		page: filters.page ?? 1,
		pageSize: 50
	});
	return {
		rows: rows.map(({ member, band: bandRow, event: eventRow, ...r }) => ({
			...r,
			booker: toBookerRef({ bookerType: r.bookerType, member, band: bandRow, event: eventRow })
		})),
		pagination
	};
});

/** Staff: tab badge counts for reservations. */
export const getReservationCounts = query(async () => {
	await requireStaff();
	const now = new Date();

	const [upcomingCount] = await db
		.select({ count: count() })
		.from(reservation)
		.where(and(gt(reservation.endsAt, now), ne(reservation.status, 'cancelled')));

	const [allCount] = await db.select({ count: count() }).from(reservation);

	return { upcoming: upcomingCount.count, all: allCount.count };
});

/** Staff: unresolved reservations (past end time, still scheduled). */
export const getUnresolvedReservations = query(async () => {
	await requireStaff();
	const now = new Date();

	const rows = await db
		.select({
			id: reservation.id,
			status: reservation.status,
			startsAt: reservation.startsAt,
			endsAt: reservation.endsAt,
			createdByUserId: reservation.createdByUserId,
			notes: reservation.notes,
			member: memberRefColumns(),
			cashDueCents: reservation.cashDueCents
		})
		.from(reservation)
		.innerJoin(user, eq(reservation.createdByUserId, user.id))
		.where(
			and(
				lt(reservation.endsAt, now),
				or(
					// Never confirmed/paid — pending resolution.
					eq(reservation.status, 'scheduled'),
					// Confirmed with cash still owed at the door.
					and(
						eq(reservation.status, 'confirmed'),
						isNull(reservation.paidAt),
						gt(reservation.cashDueCents, 0)
					)
				)
			)
		)
		.orderBy(asc(reservation.endsAt))
		.limit(LIST_LIMIT);

	return rows.map((r) => ({ ...r, member: toMemberRef(r.member) }));
});

/** Staff: current hourly rate for reservation pricing. */
export const getHourlyRate = query(async () => {
	await requireStaff();
	return config<number>('reservation.hourlyRateCents');
});

// ===========================================================================
// Forms — booking
// ===========================================================================

/**
 * Staff: create a reservation on behalf of a member, or on behalf of a band.
 *
 * A band booking is still *made by* a member — `createdByUserId` is who the
 * front desk picked, and their free hours settle it — exactly as in the
 * member-facing `bookBandReservation`. `bandId` only changes who the slot is
 * attributed to.
 */
const staffCreateSchema = z.object({
	memberId: z.string().min(1, 'Select a member'),
	bandId: z.string().optional(),
	date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date'),
	startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Invalid time'),
	endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Invalid time'),
	notes: z.string().optional()
});

export const createReservation = form(staffCreateSchema, async (data, _issue) => {
	const staffUser = await requireStaff();
	const startsAt = buildDateInTz(data.date, data.startTime, DEFAULT_TIMEZONE);
	const endsAt = buildDateInTz(data.date, data.endTime, DEFAULT_TIMEZONE);

	if (data.bandId) {
		const bookingBand = await getBandById(data.bandId);
		if (!bookingBand) error(404, 'Band not found');
	}

	const res = await staffCreate({
		userId: data.memberId,
		bookerType: data.bandId ? 'band' : 'user',
		bookerId: data.bandId ?? data.memberId,
		startsAt,
		endsAt,
		notes: data.notes,
		status: 'confirmed',
		staffUserId: staffUser.id
	});

	// The row lands directly in `confirmed`, so settle like the member confirm
	// path would: commit the member's free hours and record the cash remainder.
	// Without this, cashDueCents stays null and the reservation reads as comped
	// with no way to record a door payment.
	const reservationConfig = await getReservationConfig();
	const hourlyRateCents = reservationConfig.hourlyRateCents;
	const durationHours = (endsAt.getTime() - startsAt.getTime()) / (1000 * 60 * 60);
	const totalCents = Math.round(durationHours * hourlyRateCents);
	await commitReservationCredits({
		userId: data.memberId,
		reservationId: res.id,
		totalCents,
		durationHours,
		hourlyRateCents
	});

	return { reservationId: res.id };
});

/** Member: book a reservation (optionally recurring). */
const memberBookingSchema = createReservationSchema.extend({
	recurring: z.enum(['', 'weekly', 'biweekly', 'monthly']).optional(),
	monthlyMode: z.enum(['weekday', 'monthday']).optional()
});

export const bookMemberReservation = form(memberBookingSchema, async (data, issue) => {
	const { locals } = getRequestEvent();
	if (!locals.user) throw error(401, 'Not authenticated');

	// Before anything is written: a reservation staff can't call about is the
	// problem this guard exists to prevent.
	if (!(await ensureContactPhone(locals.user.id, data.phone))) {
		invalid(issue.phone(PHONE_REQUIRED_MESSAGE));
	}

	const recurringFrequency = data.recurring || undefined;
	const isRecurring = recurringFrequency != null;

	if (isRecurring) {
		const [row] = await db
			.select({ subscription: user.subscription })
			.from(user)
			.where(eq(user.id, locals.user.id))
			.limit(1);
		if (!row?.subscription) {
			throw error(403, 'Recurring reservations require a sustaining membership');
		}
	}

	const startsAt = buildDateInTz(data.date, data.startTime, DEFAULT_TIMEZONE);
	const endsAt = buildDateInTz(data.date, data.endTime, DEFAULT_TIMEZONE);

	let res;
	let waitlisted = false;

	try {
		res = await create({
			userId: locals.user.id,
			bookerType: 'user',
			bookerId: locals.user.id,
			startsAt,
			endsAt,
			notes: data.notes
		});
	} catch (err) {
		if (isRecurring && err instanceof ReservationConflictError) {
			res = await createWaitlisted({
				userId: locals.user.id,
				bookerType: 'user',
				bookerId: locals.user.id,
				startsAt,
				endsAt,
				notes: data.notes
			});
			waitlisted = true;
		} else {
			// Non-wizard form: map domain errors to proper HTTP responses
			// (conflict → 409, out-of-window/bad-time → 400) so the caller sees a
			// real status and message instead of a generic 500.
			mapDomainError(err);
		}
	}

	if (isRecurring && recurringFrequency) {
		await createSeries({
			prototypeReservationId: res.id,
			frequency: recurringFrequency as RecurringFrequency,
			prototypeStartsAt: startsAt,
			monthlyMode: data.monthlyMode
		});
	}

	return { reservationId: res.id, waitlisted };
});

const CONFIRM_WINDOW_MSG = `Confirmation opens ${CONFIRMATION_WINDOW_DAYS} days before your reservation — pay now to lock it in earlier.`;

/** Whether the member's free-hour balance fully covers the reservation (nothing to charge). */
async function isFullyCreditCovered(
	userId: string,
	durationHours: number,
	totalCents: number,
	hourlyRateCents: number
): Promise<boolean> {
	const freeHoursBalance = await getBalance(userId, 'free_hours');
	const { remainingCents } = computeReservationCredit({
		totalCents,
		durationHours,
		hourlyRateCents,
		freeHoursBalance
	});
	return remainingCents <= 0;
}

/**
 * Commit free-hour credits to a reservation. If credits fully cover it, settle it
 * as a credit payment (status confirmed, creditsUsed set, cashDueCents 0, paidAt
 * left null, best-effort $0 Stripe record) and return `settled: true`. Otherwise
 * return the cash remainder owed. The credit
 * commit is idempotent, so calling this from Confirm then Pay-Ahead/Cash never
 * double-deducts.
 */
async function commitCreditsAndSettleIfCovered(opts: {
	reservationId: string;
	userId: string;
	email: string;
	name: string | null;
	durationHours: number;
	totalCents: number;
	hourlyRateCents: number;
}): Promise<{ remainingCents: number; settled: boolean }> {
	const credit = await commitReservationCredits({
		userId: opts.userId,
		reservationId: opts.reservationId,
		totalCents: opts.totalCents,
		durationHours: opts.durationHours,
		hourlyRateCents: opts.hourlyRateCents
	});

	if (credit.remainingCents > 0) {
		return { remainingCents: credit.remainingCents, settled: false };
	}

	// Fully covered by free hours → settle as a credit payment. The $0 Stripe
	// record is best-effort; the committed credits are the authoritative settlement.
	let stripePaymentRecordId: string | null = null;
	try {
		const stripeCustomerId = await ensureStripeCustomer(
			opts.userId,
			opts.email,
			opts.name ?? undefined
		);
		const rec = await recordCashPayment({
			userId: opts.userId,
			stripeCustomerId,
			amountCents: 0,
			displayName: 'Credits',
			metadata: { reservation_id: opts.reservationId }
		});
		stripePaymentRecordId = rec.paymentRecordId;
	} catch (err) {
		console.error('[reservation] $0 credit settlement record failed (settling anyway):', err);
	}

	// Guarded by status so a cancelled/completed/no_show row can never be
	// flipped back to confirmed by a late or repeated settle call.
	await db
		.update(reservation)
		.set({
			status: 'confirmed',
			// paidAt intentionally left null — credit-settled, not cash-paid. The
			// $0 stripePaymentRecordId is the best-effort receipt; creditsUsed is
			// what marks this as "Paid with credits" vs. a true comp.
			stripePaymentRecordId,
			cashDueCents: 0,
			creditsUsed: opts.durationHours,
			updatedAt: new Date()
		})
		.where(
			and(
				eq(reservation.id, opts.reservationId),
				inArray(reservation.status, ['scheduled', 'confirmed'])
			)
		);

	return { remainingCents: 0, settled: true };
}

/**
 * Pay for an existing reservation: commit free hours, then either settle (fully
 * covered) or charge the cash remainder online. Credits are committed once
 * (idempotent) and not re-applied inside checkout.
 */
async function payReservationRemainder(opts: {
	row: { id: string; startsAt: Date; endsAt: Date };
	userId: string;
	email: string;
	name: string | null;
	coverFees: boolean;
	successUrl: string;
	cancelUrl: string;
}): Promise<{ paid: true } | { checkoutUrl: string }> {
	const reservationConfig = await getReservationConfig();
	const hourlyRateCents = reservationConfig.hourlyRateCents;
	const durationHours =
		(opts.row.endsAt.getTime() - opts.row.startsAt.getTime()) / (1000 * 60 * 60);
	const totalCents = Math.round(durationHours * hourlyRateCents);

	const { remainingCents, settled } = await commitCreditsAndSettleIfCovered({
		reservationId: opts.row.id,
		userId: opts.userId,
		email: opts.email,
		name: opts.name,
		durationHours,
		totalCents,
		hourlyRateCents
	});
	if (settled) return { paid: true };

	const stripeCustomerId = await ensureStripeCustomer(
		opts.userId,
		opts.email,
		opts.name ?? undefined
	);
	const result = await checkout({
		stripeCustomerId,
		customerEmail: opts.email,
		userId: opts.userId,
		mode: 'payment',
		lineItems: [
			{
				price_data: {
					currency: 'usd',
					product_data: { name: 'Practice Room Rental' },
					unit_amount: remainingCents
				},
				quantity: 1
			}
		],
		// Credits already committed against this reservation — don't deduct again.
		eligibleCredits: [],
		coverFees: opts.coverFees,
		metadata: { reservation_id: opts.row.id },
		successUrl: opts.successUrl,
		cancelUrl: opts.cancelUrl
	});

	if (result.paid) {
		await db
			.update(reservation)
			.set({
				status: 'confirmed',
				stripePaymentRecordId: result.stripePaymentRecordId ?? null,
				paidAt: new Date(),
				cashDueCents: 0,
				updatedAt: new Date()
			})
			.where(eq(reservation.id, opts.row.id));
		return { paid: true };
	}

	return { checkoutUrl: result.checkoutUrl! };
}

/** Member: book a reservation and immediately initiate payment. */
const bookAndPaySchema = createReservationSchema.extend({
	recurring: z.enum(['', 'weekly', 'biweekly', 'monthly']).optional(),
	monthlyMode: z.enum(['weekday', 'monthday']).optional(),
	coverFees: z.boolean().default(false),
	skipPayment: z.enum(['', 'on']).optional()
});

export const bookAndPayReservation = form(bookAndPaySchema, async (data, issue) => {
	const { locals, url } = getRequestEvent();
	if (!locals.user) throw error(401, 'Not authenticated');

	// Before anything is written: a reservation staff can't call about is the
	// problem this guard exists to prevent.
	if (!(await ensureContactPhone(locals.user.id, data.phone))) {
		invalid(issue.phone(PHONE_REQUIRED_MESSAGE));
	}

	const recurringFrequency = data.recurring || undefined;
	const isRecurring = recurringFrequency != null;

	if (isRecurring) {
		const [row] = await db
			.select({ subscription: user.subscription })
			.from(user)
			.where(eq(user.id, locals.user.id))
			.limit(1);
		if (!row?.subscription) {
			throw error(403, 'Recurring reservations require a sustaining membership');
		}
	}

	const startsAt = buildDateInTz(data.date, data.startTime, DEFAULT_TIMEZONE);
	const endsAt = buildDateInTz(data.date, data.endTime, DEFAULT_TIMEZONE);

	let res;
	let waitlisted = false;

	try {
		res = await create({
			userId: locals.user.id,
			bookerType: 'user',
			bookerId: locals.user.id,
			startsAt,
			endsAt,
			notes: data.notes
		});
	} catch (err) {
		if (err instanceof ReservationConflictError) {
			if (isRecurring) {
				res = await createWaitlisted({
					userId: locals.user.id,
					bookerType: 'user',
					bookerId: locals.user.id,
					startsAt,
					endsAt,
					notes: data.notes
				});
				waitlisted = true;
			} else {
				// One-time slot was taken between selection and submit. create()
				// checks conflicts before inserting, so nothing was written — signal
				// the wizard to send the member back to a refreshed time picker
				// rather than surfacing a 500.
				return { conflict: true as const };
			}
		} else if (err instanceof ReservationValidationError) {
			// Wizard form: return the message in-band (not via mapDomainError's
			// thrown 400) so the multi-step modal can show it, reset to the date/time
			// step, and reload availability — see BookingConflict.svelte. A thrown
			// HTTP error would only surface a generic toast and lose that recovery.
			return { validationError: err.message };
		} else {
			throw err;
		}
	}

	if (isRecurring && recurringFrequency) {
		await createSeries({
			prototypeReservationId: res.id,
			frequency: recurringFrequency as RecurringFrequency,
			prototypeStartsAt: startsAt,
			monthlyMode: data.monthlyMode
		});
	}

	// Waitlisted reservations skip payment — collect when slot opens
	if (waitlisted) {
		return { reservationId: res.id, waitlisted: true as const };
	}

	const reservationConfig = await getReservationConfig();
	const hourlyRateCents = reservationConfig.hourlyRateCents;
	const durationHours = (endsAt.getTime() - startsAt.getTime()) / (1000 * 60 * 60);
	const totalCents = Math.round(durationHours * hourlyRateCents);

	// Only a real Stripe charge (or staff) confirms a reservation outside the
	// confirmation window.
	const staff = await isStaff(locals.user.id);
	const outsideWindow = !staff && !withinConfirmationWindow(startsAt);

	if (data.skipPayment === 'on') {
		// Confirm: commit free hours now. If fully covered, it's settled; otherwise
		// the cash remainder is collected at the door.
		if (outsideWindow) throw error(400, CONFIRM_WINDOW_MSG);
		const { settled } = await commitCreditsAndSettleIfCovered({
			reservationId: res.id,
			userId: locals.user.id,
			email: locals.user.email,
			name: locals.user.name,
			durationHours,
			totalCents,
			hourlyRateCents
		});
		if (!settled) {
			await db
				.update(reservation)
				.set({ status: 'confirmed', updatedAt: new Date() })
				.where(eq(reservation.id, res.id));
		}
		return { reservationId: res.id, confirmed: true as const };
	}

	// Pay Ahead: a fully credit-covered booking would confirm without a charge, so
	// it's blocked outside the window — only a real charge commits early.
	if (
		outsideWindow &&
		(await isFullyCreditCovered(locals.user.id, durationHours, totalCents, hourlyRateCents))
	)
		throw error(400, CONFIRM_WINDOW_MSG);

	// Pay Ahead: commit free hours, then charge any cash remainder online now.
	const { remainingCents, settled } = await commitCreditsAndSettleIfCovered({
		reservationId: res.id,
		userId: locals.user.id,
		email: locals.user.email,
		name: locals.user.name,
		durationHours,
		totalCents,
		hourlyRateCents
	});
	if (settled) {
		return { reservationId: res.id, paid: true as const };
	}

	const lineItem: CheckoutLineItem = {
		price_data: {
			currency: 'usd',
			product_data: { name: 'Practice Room Rental' },
			unit_amount: remainingCents
		},
		quantity: 1
	};

	const stripeCustomerId = await ensureStripeCustomer(
		locals.user.id,
		locals.user.email,
		locals.user.name
	);

	const result = await checkout({
		stripeCustomerId,
		customerEmail: locals.user.email,
		userId: locals.user.id,
		mode: 'payment',
		lineItems: [lineItem],
		// Credits already committed against this reservation — don't deduct again.
		eligibleCredits: [],
		coverFees: data.coverFees,
		metadata: { reservation_id: res.id },
		successUrl: `${url.origin}/member/reservations`,
		cancelUrl: `${url.origin}/member/reservations`
	});

	if (result.paid) {
		await db
			.update(reservation)
			.set({
				status: 'confirmed',
				stripePaymentRecordId: result.stripePaymentRecordId ?? null,
				paidAt: new Date(),
				cashDueCents: 0,
				updatedAt: new Date()
			})
			.where(eq(reservation.id, res.id));

		return { reservationId: res.id, paid: true as const };
	}

	return { reservationId: res.id, paid: false as const, redirectUrl: result.checkoutUrl! };
});

/** Band: book a reservation (optionally recurring). */
const bandBookingSchema = createReservationSchema.extend({
	recurring: z.enum(['', 'weekly', 'biweekly', 'monthly']).optional(),
	monthlyMode: z.enum(['weekday', 'monthday']).optional()
});

export const bookBandReservation = form(bandBookingSchema, async (data, issue) => {
	const { band } = await requireBandMember();
	const currentUser = requireUser();

	// The band books, but a person is on the hook — same guard as a solo booking.
	if (!(await ensureContactPhone(currentUser.id, data.phone))) {
		invalid(issue.phone(PHONE_REQUIRED_MESSAGE));
	}

	const recurringFrequency = data.recurring || undefined;
	const isRecurring = recurringFrequency != null;
	const startsAt = buildDateInTz(data.date, data.startTime, DEFAULT_TIMEZONE);
	const endsAt = buildDateInTz(data.date, data.endTime, DEFAULT_TIMEZONE);

	let res;
	let waitlisted = false;

	try {
		res = await create({
			userId: currentUser.id,
			bookerType: 'band',
			bookerId: band.id,
			startsAt,
			endsAt,
			notes: data.notes
		});
	} catch (err) {
		if (isRecurring && err instanceof ReservationConflictError) {
			res = await createWaitlisted({
				userId: currentUser.id,
				bookerType: 'band',
				bookerId: band.id,
				startsAt,
				endsAt,
				notes: data.notes
			});
			waitlisted = true;
		} else {
			// Non-wizard form: map domain errors to proper HTTP responses
			// (conflict → 409, out-of-window/bad-time → 400) so the caller sees a
			// real status and message instead of a generic 500.
			mapDomainError(err);
		}
	}

	if (recurringFrequency) {
		const members = await getMembers(band.id);
		const activeUserIds = members.filter((m) => m.status === 'active').map((m) => m.userId);
		const [sustaining] = await db
			.select({ id: user.id })
			.from(user)
			.where(and(inArray(user.id, activeUserIds), sql`subscription is not null`))
			.limit(1);

		if (!sustaining) {
			throw error(
				403,
				'Recurring reservations require at least one band member with a sustaining membership'
			);
		}

		await createSeries({
			prototypeReservationId: res.id,
			frequency: recurringFrequency as RecurringFrequency,
			prototypeStartsAt: startsAt,
			monthlyMode: data.monthlyMode
		});
	}

	return { reservationId: res.id, waitlisted };
});

/**
 * Band: cancel a band reservation.
 *
 * A band admin may cancel any of their band's sessions; everyone else only the
 * ones they booked. Previously this passed straight to `cancel()`, which
 * authorizes on `createdByUserId`, so a bandmate who hadn't booked got an error
 * toast from a button the page showed them anyway. It also never checked that
 * the reservation belonged to the guarded band.
 */
export const cancelBandReservation = form(
	z.object({
		reservationId: z.string().min(1)
	}),
	async (data, _issue) => {
		// A mutation, so the member-only guard — not `…OrStaff`. Staff cancel
		// through their own reservation surface, which carries the audit trail.
		const { user: currentUser, band, role } = await requireBandMember();

		const [row] = await db
			.select({
				bookerType: reservation.bookerType,
				bookerId: reservation.bookerId,
				createdByUserId: reservation.createdByUserId
			})
			.from(reservation)
			.where(eq(reservation.id, data.reservationId))
			.limit(1);

		// 404 rather than 403: whether some other band's reservation exists is not
		// this band's business.
		if (!row || row.bookerType !== 'band' || row.bookerId !== band.id) {
			error(404, 'Reservation not found');
		}

		const bandAdmin = role === 'owner' || role === 'admin';
		if (!bandAdmin && row.createdByUserId !== currentUser.id) {
			error(403, 'Only the member who booked this session, or a band admin, can cancel it');
		}

		try {
			// `authorizedActor`, never `staffOverride`: a band admin must still not
			// cancel a session that has already started, and the cancellation is a
			// member cancellation as far as the waitlist and notifications go.
			await cancel(
				data.reservationId,
				currentUser.id,
				undefined,
				bandAdmin ? { authorizedActor: true } : undefined
			);
		} catch (err) {
			mapDomainError(err);
		}
		return { success: true };
	}
);

/** Member: pay for an existing reservation via Stripe checkout (from action modal). */
export const payForReservation = form(
	z.object({
		id: z.string(),
		coverFees: z.boolean().default(false),
		skipPayment: z.enum(['', 'on']).optional()
	}),
	async (data, _issue) => {
		const currentUser = requireUser();
		const { url } = getRequestEvent();

		const [row] = await db.select().from(reservation).where(eq(reservation.id, data.id)).limit(1);

		if (!row) throw error(404, 'Reservation not found');
		if (row.createdByUserId !== currentUser.id) throw error(403, 'Not your reservation');
		if (row.status !== 'scheduled' && row.status !== 'confirmed')
			throw error(400, 'Not eligible for payment');

		const staff = await isStaff(currentUser.id);
		const reservationConfig = await getReservationConfig();
		const hourlyRateCents = reservationConfig.hourlyRateCents;
		const durationHours = (row.endsAt.getTime() - row.startsAt.getTime()) / (1000 * 60 * 60);
		const totalCents = Math.round(durationHours * hourlyRateCents);
		const outsideWindow = !staff && !withinConfirmationWindow(row.startsAt);

		if (data.skipPayment === 'on') {
			// Confirm: commit free hours; settle if fully covered, else cash at door.
			// Only a real Stripe charge confirms outside the window.
			if (outsideWindow) throw error(400, CONFIRM_WINDOW_MSG);
			const { settled } = await commitCreditsAndSettleIfCovered({
				reservationId: row.id,
				userId: currentUser.id,
				email: currentUser.email,
				name: currentUser.name,
				durationHours,
				totalCents,
				hourlyRateCents
			});
			if (!settled && row.status === 'scheduled') await confirm(row.id);
			return { confirmed: true };
		}

		// Pay online: outside the window this is only allowed when there is a real
		// charge — a fully credit-covered "payment" is just a credit confirmation.
		if (
			outsideWindow &&
			(await isFullyCreditCovered(currentUser.id, durationHours, totalCents, hourlyRateCents))
		)
			throw error(400, CONFIRM_WINDOW_MSG);

		const result = await payReservationRemainder({
			row,
			userId: currentUser.id,
			email: currentUser.email,
			name: currentUser.name,
			coverFees: data.coverFees,
			successUrl: `${url.origin}/member/reservations`,
			cancelUrl: `${url.origin}/member/reservations`
		});

		return 'paid' in result ? { paid: true } : { redirectUrl: result.checkoutUrl };
	}
);

/** Member: pay for a reservation via Stripe checkout (from pay page). */
export const payReservation = form(
	z.object({
		coverFees: z.boolean().default(false)
	}),
	async (data, _issue) => {
		const currentUser = requireUser();
		const { params, url } = getRequestEvent();

		const [row] = await db
			.select()
			.from(reservation)
			.where(eq(reservation.id, params.id!))
			.limit(1);

		if (!row) throw error(404, 'Reservation not found');
		if (row.createdByUserId !== currentUser.id) throw error(403, 'Not your reservation');
		if (row.status !== 'scheduled' && row.status !== 'confirmed')
			throw error(400, 'Not eligible for payment');

		// Outside the confirmation window a fully credit-covered "payment" is just a
		// credit confirmation — only a real Stripe charge confirms early.
		const staff = await isStaff(currentUser.id);
		if (!staff && !withinConfirmationWindow(row.startsAt)) {
			const reservationConfig = await getReservationConfig();
			const hourlyRateCents = reservationConfig.hourlyRateCents;
			const durationHours = (row.endsAt.getTime() - row.startsAt.getTime()) / (1000 * 60 * 60);
			const totalCents = Math.round(durationHours * hourlyRateCents);
			if (await isFullyCreditCovered(currentUser.id, durationHours, totalCents, hourlyRateCents))
				throw error(400, CONFIRM_WINDOW_MSG);
		}

		const result = await payReservationRemainder({
			row,
			userId: currentUser.id,
			email: currentUser.email,
			name: currentUser.name,
			coverFees: data.coverFees,
			successUrl: `${url.origin}/member/reservations`,
			cancelUrl: `${url.origin}/member/reservations/${row.id}/pay`
		});

		redirect(303, 'paid' in result ? '/member/reservations' : result.checkoutUrl);
	}
);

// ===========================================================================
// Forms — staff actions (converted from API routes)
// ===========================================================================

/**
 * Staff/owner: confirm a reservation. Staff may submit with comp=on to waive
 * payment entirely instead of committing the owner's credits.
 */
export const confirmReservation = form(
	z.object({ id: z.string(), comp: z.enum(['', 'on']).optional() }),
	async (data, _issue) => {
		const currentUser = requireUser();

		const [row] = await db
			.select({
				id: reservation.id,
				createdByUserId: reservation.createdByUserId,
				startsAt: reservation.startsAt,
				endsAt: reservation.endsAt,
				status: reservation.status
			})
			.from(reservation)
			.where(eq(reservation.id, data.id))
			.limit(1);
		if (!row) throw error(404, 'Reservation not found');

		// Returns which of the two the caller is, which the confirmation-window and
		// comp rules below both branch on.
		const staff = (await requireStaffOrOwner(currentUser.id, row.createdByUserId)) === 'staff';

		// Only live reservations can be confirmed. Without this, a cancelled
		// reservation (credits already reversed, cashDueCents possibly 0) would be
		// resurrected to confirmed for free by the settle path below.
		if (row.status !== 'scheduled' && row.status !== 'confirmed')
			throw error(400, 'Not eligible for confirmation');

		// Members may only confirm (without a Stripe charge) within the window; staff
		// override anytime.
		if (!staff && !withinConfirmationWindow(row.startsAt)) throw error(400, CONFIRM_WINDOW_MSG);

		if (data.comp === 'on') {
			// Comp is a staff-only choice: fully free, no credits committed.
			if (!staff) throw error(403, 'Not authorized');
			if (row.status === 'scheduled') await confirm(row.id);
			await db
				.update(reservation)
				.set({ cashDueCents: 0, updatedAt: new Date() })
				.where(eq(reservation.id, row.id));
			return { success: true };
		}

		// Commit the owner's free hours; settle if fully covered, else confirm with
		// the cash remainder owed at the door.
		const [owner] = await db
			.select({ email: user.email, name: user.name })
			.from(user)
			.where(eq(user.id, row.createdByUserId))
			.limit(1);
		const reservationConfig = await getReservationConfig();
		const hourlyRateCents = reservationConfig.hourlyRateCents;
		const durationHours = (row.endsAt.getTime() - row.startsAt.getTime()) / (1000 * 60 * 60);
		const totalCents = Math.round(durationHours * hourlyRateCents);
		const { settled } = await commitCreditsAndSettleIfCovered({
			reservationId: row.id,
			userId: row.createdByUserId,
			email: owner?.email ?? '',
			name: owner?.name ?? null,
			durationHours,
			totalCents,
			hourlyRateCents
		});
		if (!settled && row.status === 'scheduled') await confirm(row.id);
		return { success: true };
	}
);

/** Cancel a reservation (staff can override). */
export const cancelReservation = form(
	z.object({
		id: z.string(),
		reason: z.string().optional()
	}),
	async (data, _issue) => {
		const currentUser = requireUser();
		const staff = await isStaff(currentUser.id);
		try {
			await cancel(data.id, currentUser.id, data.reason, { staffOverride: staff });
		} catch (err) {
			mapDomainError(err);
		}
		return { success: true };
	}
);

/** Staff: mark a reservation as completed. */
export const completeReservation = form(z.object({ id: z.string() }), async (data, _issue) => {
	await requireStaff();
	await markComplete(data.id);
	return { success: true };
});

/** Staff: mark a reservation as no-show. */
export const noShowReservation = form(z.object({ id: z.string() }), async (data, _issue) => {
	await requireStaff();
	await markNoShow(data.id);
	return { success: true };
});

/** Staff: record cash payment and complete reservation. */
export const cashReceivedReservation = form(z.object({ id: z.string() }), async (data, _issue) => {
	await requireStaff();

	const [row] = await db
		.select({
			createdByUserId: reservation.createdByUserId,
			startsAt: reservation.startsAt,
			endsAt: reservation.endsAt
		})
		.from(reservation)
		.where(eq(reservation.id, data.id))
		.limit(1);
	if (!row) throw error(404, 'Reservation not found');

	const durationHours = (row.endsAt.getTime() - row.startsAt.getTime()) / (1000 * 60 * 60);
	const hourlyRateCents = await config<number>('reservation.hourlyRateCents');
	const totalCents = Math.round(durationHours * hourlyRateCents);

	// Commit the member's free hours (idempotent — already done if confirmed
	// ahead of time), then collect only the cash remainder.
	const { remainingCents } = await commitCreditsAndSettleIfCovered({
		reservationId: data.id,
		userId: row.createdByUserId,
		email: '',
		name: null,
		durationHours,
		totalCents,
		hourlyRateCents
	});

	let paymentRecordId: string;
	if (remainingCents > 0) {
		const [member] = await db
			.select({ stripeId: user.stripeId })
			.from(user)
			.where(eq(user.id, row.createdByUserId))
			.limit(1);
		if (!member?.stripeId) throw error(400, 'Member has no Stripe customer ID');

		({ paymentRecordId } = await recordCashPayment({
			userId: row.createdByUserId,
			stripeCustomerId: member.stripeId,
			amountCents: remainingCents,
			metadata: { reservation_id: data.id }
		}));
	} else {
		// Fully covered by credits — already settled by the commit (creditsUsed set).
		const [r] = await db
			.select({ rec: reservation.stripePaymentRecordId })
			.from(reservation)
			.where(eq(reservation.id, data.id))
			.limit(1);
		paymentRecordId = r?.rec ?? '';
	}

	await recordCashAndComplete(data.id, paymentRecordId);
	return { success: true };
});

/** Staff: comp a reservation (waive payment and confirm — no credits used). */
export const compReservation = form(z.object({ id: z.string() }), async (data, _issue) => {
	await requireStaff();
	await confirm(data.id);
	await db
		.update(reservation)
		.set({ cashDueCents: 0, updatedAt: new Date() })
		.where(eq(reservation.id, data.id));
	return { success: true };
});

/** Staff: refund the payment on a reservation. */
export const refundReservation = form(z.object({ id: z.string() }), async (data, _issue) => {
	await requireStaff();

	const [row] = await db
		.select({
			createdByUserId: reservation.createdByUserId,
			stripePaymentRecordId: reservation.stripePaymentRecordId
		})
		.from(reservation)
		.where(eq(reservation.id, data.id))
		.limit(1);
	if (!row) throw error(404, 'Reservation not found');
	if (!row.stripePaymentRecordId) throw error(400, 'No payment to refund');

	await refundPayment({
		userId: row.createdByUserId,
		stripePaymentRecordId: row.stripePaymentRecordId
	});
	// Reservation free-hour credits live in the ledger (not the payment record's
	// breakdown), so reverse them explicitly. Idempotent and a no-op when none.
	await reverseReservationCredits(row.createdByUserId, data.id);
	await db.update(reservation).set({ refundedAt: new Date() }).where(eq(reservation.id, data.id));
	return { success: true };
});

/** Member: confirm a waitlisted reservation when the slot opens. */
export const confirmWaitlisted = form(z.object({ id: z.string() }), async (data, _issue) => {
	const { locals } = getRequestEvent();
	if (!locals.user) throw error(401, 'Not authenticated');

	const [row] = await db.select().from(reservation).where(eq(reservation.id, data.id)).limit(1);

	if (!row) throw error(404, 'Reservation not found');
	if (row.createdByUserId !== locals.user.id) throw error(403, 'Not your reservation');
	if (row.status !== 'waitlisted') throw error(400, 'Reservation is not waitlisted');
	if (!row.waitlistNotifiedAt) throw error(400, 'Slot has not been offered yet');
	if (row.waitlistExpiresAt && row.waitlistExpiresAt < new Date()) {
		throw error(400, 'Confirmation window has expired');
	}

	// Re-check slot is still free
	const conflicts = await db
		.select({ id: reservation.id })
		.from(reservation)
		.where(
			and(
				notInArray(reservation.status, ['cancelled', 'waitlisted']),
				lt(reservation.startsAt, row.endsAt),
				gt(reservation.endsAt, row.startsAt),
				ne(reservation.id, data.id)
			)
		)
		.limit(1);

	if (conflicts.length > 0) {
		throw error(409, 'Slot is no longer available');
	}

	await db
		.update(reservation)
		.set({
			status: 'scheduled',
			waitlistNotifiedAt: null,
			waitlistExpiresAt: null,
			updatedAt: new Date()
		})
		.where(eq(reservation.id, data.id));

	// Post-update re-check narrows the check-then-write race (no transactions on
	// D1): if a competing booking landed between the check above and our update,
	// back out to waitlisted rather than leave a double-booked slot.
	const raced = await db
		.select({ id: reservation.id })
		.from(reservation)
		.where(
			and(
				notInArray(reservation.status, ['cancelled', 'waitlisted']),
				lt(reservation.startsAt, row.endsAt),
				gt(reservation.endsAt, row.startsAt),
				ne(reservation.id, data.id)
			)
		)
		.limit(1);

	if (raced.length > 0) {
		await db
			.update(reservation)
			.set({ status: 'waitlisted', updatedAt: new Date() })
			.where(eq(reservation.id, data.id));
		throw error(409, 'Slot is no longer available');
	}

	return { success: true };
});

type ReservationWithPrice = Reservation & { price: number; creditsAvailable: boolean };
export const getReservations = query(
	z
		.object({
			after: z.coerce.date().optional(),
			forUser: z.string().optional(),
			includeTerminal: z.boolean().optional()
		})
		.optional(),
	async ({ after, forUser, includeTerminal } = {}): Promise<ReservationWithPrice[]> => {
		const { locals } = getRequestEvent();

		if (!locals.user) throw error(401, 'Not authenticated');
		if (forUser && !locals.user.isStaff && forUser !== locals.user.id) {
			throw error(403, "Not authorized to view other users' reservations");
		}

		const filters = [
			eq(reservation.createdByUserId, forUser ?? locals.user?.id),
			// Space a staff member booked for an event is the venue's, not theirs —
			// it has no member confirm/pay flow, so listing it here offered actions
			// that don't apply.
			ne(reservation.bookerType, 'event'),
			after && gt(reservation.endsAt, after),
			!includeTerminal && inArray(reservation.status, ['scheduled', 'confirmed', 'waitlisted'])
		];
		const rateInCents = await config<number>('reservation.hourlyRateCents');
		const freeHoursBalance = await getBalance(forUser ?? locals.user.id, 'free_hours');

		const rows = await db
			.select()
			.from(reservation)
			.where(and(...(filters.filter(Boolean) as any[])))
			.orderBy(reservation.startsAt);

		// `price` is the full room rate. We deliberately do NOT project a credit
		// discount onto uncommitted bookings here: free hours are only applied at
		// confirm/pay time, against the live balance. Projecting a discounted
		// figure on the listing drifts from the modal (which computes credits live,
		// at the moment of the charge) and confused members with a lower number on
		// the card than at Pay Ahead. Instead, show the full price and flag that
		// credits are available so the UI can indicate they'll apply.
		// Confirmed/paid rows carry the real cash owed in cashDueCents (0 = fully
		// covered by credits).
		const hasFreeHours = freeHoursBalance > 0;
		return rows.map((value: Reservation) => {
			const durationHours = (value.endsAt.getTime() - value.startsAt.getTime()) / (1000 * 60 * 60);
			const totalCents = Math.round(durationHours * rateInCents);
			const isTerminal = isTerminalStatus(value.status);

			// Committed rows owe their stored remainder; everything else owes full price.
			const netCents = value.cashDueCents ?? totalCents;
			// Credits can still apply only to an uncommitted, non-terminal booking.
			const creditsAvailable = hasFreeHours && value.cashDueCents == null && !isTerminal;

			return { ...value, price: netCents / 100, creditsAvailable };
		});
	}
);

export const getRecurringReservations = query(
	z
		.object({
			includeCancelled: z.boolean().optional()
		})
		.optional(),
	async (options) => {
		const includeCancelled = options?.includeCancelled ?? false;

		const filters = [
			eq(reservation.createdByUserId, getRequestEvent().locals.user?.id),
			eq(recurringSeries.prototypeType, 'reservation'),
			isNull(recurringSeries.supersededBy),
			!includeCancelled && isNull(recurringSeries.cancelledAt)
		];

		const rows = await db
			.select({
				id: recurringSeries.id,
				rrule: recurringSeries.rrule,
				createdAt: recurringSeries.createdAt,
				seriesEndsAt: recurringSeries.endsAt,
				cancelledAt: recurringSeries.cancelledAt,
				bookerType: reservation.bookerType,
				startsAt: reservation.startsAt,
				endsAt: reservation.endsAt
			})
			.from(recurringSeries)
			.innerJoin(reservation, eq(recurringSeries.prototypeId, reservation.id))
			.where(and(...(filters.filter(Boolean) as any[])));

		return rows.map((r) => ({
			...r,
			frequencyLabel: describeFrequency(r.rrule),
			monthlyMode: monthlyModeOf(r.rrule)
		}));
	}
);

// ---------------------------------------------------------------------------
// Staff user record (/staff/users/[id])
// ---------------------------------------------------------------------------
// Read-only, staff-guarded, and scoped by an explicit userId argument rather
// than `params.id`, which on a remote call comes from a caller-supplied header.
// ---------------------------------------------------------------------------

export const getUserRecurringSeries = query(z.string(), async (userId) => {
	await requireStaff();
	return listActiveSeries({ forUser: userId });
});
