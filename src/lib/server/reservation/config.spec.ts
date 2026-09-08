/**
 * `termsFor` is the single place that decides what a booking costs and how far
 * ahead it may be made. It is pure, so this needs no config read and no mock —
 * which is the reason the resolver was split from `getBookingTerms` at all.
 *
 * The point of the file is to stop a future booker type silently inheriting
 * teaching terms, or teaching silently inheriting the drop-in rate.
 */
import { describe, it, expect } from 'vitest';
import {
	termsFor,
	type ReservationConfig,
	DEFAULT_MIN_DURATION_HOURS,
	DEFAULT_MAX_ADVANCE_DAYS_ONEOFF,
	DEFAULT_MAX_ADVANCE_DAYS_RECURRING,
	DEFAULT_TEACHING_RATE_CENTS,
	DEFAULT_TEACHING_MIN_DURATION_HOURS,
	DEFAULT_TEACHING_MAX_ADVANCE_DAYS_ONEOFF,
	DEFAULT_TEACHING_MAX_ADVANCE_DAYS_RECURRING
} from './config';
import { bookerTypes } from '$lib/config';
import { MINUTES_PER_CREDIT, creditValueCents } from '$lib/config';

const cfg: ReservationConfig = {
	timeSlotMinutes: 30,
	minDurationHours: DEFAULT_MIN_DURATION_HOURS,
	maxDurationHours: 8,
	operatingHoursStart: '09:00',
	operatingHoursEnd: '22:00',
	bufferMinutes: 0,
	minAdvanceMinutes: 60,
	maxAdvanceDaysOneoff: DEFAULT_MAX_ADVANCE_DAYS_ONEOFF,
	maxAdvanceDaysRecurring: DEFAULT_MAX_ADVANCE_DAYS_RECURRING,
	hourlyRateCents: 1500,
	teachingRateCents: DEFAULT_TEACHING_RATE_CENTS,
	teachingMinDurationHours: DEFAULT_TEACHING_MIN_DURATION_HOURS,
	teachingMaxAdvanceDaysOneoff: DEFAULT_TEACHING_MAX_ADVANCE_DAYS_ONEOFF,
	teachingMaxAdvanceDaysRecurring: DEFAULT_TEACHING_MAX_ADVANCE_DAYS_RECURRING
};

describe('termsFor', () => {
	it('gives teaching its own rate, floor and windows', () => {
		expect(termsFor('instructor', cfg)).toEqual({
			hourlyRateCents: 500,
			minDurationHours: 0.5,
			maxAdvanceDaysOneoff: 60,
			maxAdvanceDaysRecurring: 90
		});
	});

	// The whole point of the resolver: `'instructor'` is matched positively, so a
	// sixth booker type added tomorrow gets member terms rather than teaching ones
	// by omission. Written as `!== 'user'` this would have leaked the teaching
	// rate to bands and events.
	it.each(bookerTypes.filter((t) => t !== 'instructor'))('gives %s the member terms', (t) => {
		expect(termsFor(t, cfg)).toEqual({
			hourlyRateCents: cfg.hourlyRateCents,
			minDurationHours: cfg.minDurationHours,
			maxAdvanceDaysOneoff: cfg.maxAdvanceDaysOneoff,
			maxAdvanceDaysRecurring: cfg.maxAdvanceDaysRecurring
		});
	});

	it('is a strict no-op for every booker type that exists today', () => {
		// Step 3 claims to be an inert refactor. This is that claim: nothing writes
		// `'instructor'` yet, so every live row resolves to exactly the config rate
		// the call sites read directly before.
		for (const t of bookerTypes.filter((t) => t !== 'instructor')) {
			expect(termsFor(t, cfg).hourlyRateCents).toBe(cfg.hourlyRateCents);
		}
	});
});

describe('the constraints the terms have to satisfy', () => {
	it('keeps the teaching recurring window beyond any member one-off booking', () => {
		// A teaching series is Tier 2 in the generator and can be waitlisted behind
		// a member's one-off. The mitigation is that the series is already
		// materialised before a member can reach that week — which holds only while
		// this inequality does. `updateReservationSettings` refuses to save config
		// that breaks it; this pins the defaults.
		expect(cfg.teachingMaxAdvanceDaysRecurring).toBeGreaterThan(cfg.maxAdvanceDaysOneoff);
	});

	it('lets a half-hour lesson exist at all', () => {
		// `minDurationHours: 1` forbids one outright, which is why teaching needs
		// its own floor rather than a shared one.
		expect(termsFor('instructor', cfg).minDurationHours).toBeLessThan(cfg.minDurationHours);
		expect(termsFor('instructor', cfg).minDurationHours).toBe(MINUTES_PER_CREDIT / 60);
	});

	it('prices one credit at exactly one half-hour slot of teaching', () => {
		// The reason credits apply to teaching rather than being withheld: at $5/hr
		// a credit's value and a half-hour's cost are the same number, so the ledger
		// never reasons about partial coverage on a teaching booking.
		const { hourlyRateCents } = termsFor('instructor', cfg);
		const halfHourCost = Math.round(hourlyRateCents * (MINUTES_PER_CREDIT / 60));
		expect(creditValueCents(hourlyRateCents)).toBe(halfHourCost);
	});

	it('charges teaching what a sustaining contribution already buys', () => {
		// $5 = 1 hour = 2 credits, per webhook-handlers.ts. The teaching rate is the
		// member rate uncapped, not a discount on the drop-in rate — if this ever
		// drifts below, the equivalence that makes it defensible is gone.
		expect(termsFor('instructor', cfg).hourlyRateCents).toBe(500);
	});
});
