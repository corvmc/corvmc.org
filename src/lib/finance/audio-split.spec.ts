import { describe, it, expect } from 'vitest';
import {
	computeAudioSplit,
	defaultSplit,
	validateSplit,
	suggestedPlatformCents,
	divisibleCents
} from './audio-split';
import { AUDIO_MIN_PRICE_CENTS } from '$lib/config';

/**
 * The Connect adapter over `split.ts`, which owns the arithmetic and has its own
 * spec. What is tested here is what only this module knows: the two figures that
 * are *routed* rather than merely recorded — the band's transfer and
 * `application_fee_amount` — and the agreed commercial model, to the cent.
 *
 * These are the numbers that must not diverge. What the buyer is shown, what
 * Stripe is told, and what the band is paid all come from here; a second
 * implementation anywhere would eventually show one figure and pay another.
 */
describe('the agreed model, at the default position', () => {
	it('takes card processing off the top, then divides what is left', () => {
		const split = defaultSplit(1000, false);

		expect(split.chargeCents).toBe(1000);
		expect(split.stripeFeeCents).toBe(59);
		// 10% of the $9.41 that is actually divisible — not of the gross, which
		// would name a share of money the card network has already taken.
		expect(split.platformNetCents).toBe(94);
		expect(split.bandCents).toBe(847);
		// Stripe bills the *platform* on a destination charge, so the application
		// fee carries CMC's share and the fee both.
		expect(split.applicationFeeCents).toBe(153);
		expect(split.feeCoveredCents).toBe(0);
	});

	it('lets both sides keep their whole allocation when the buyer covers fees', () => {
		const split = defaultSplit(1000, true);

		expect(split.chargeCents).toBe(1061);
		expect(split.feeCoveredCents).toBe(61);
		expect(split.stripeFeeCents).toBe(61);
		expect(split.platformNetCents).toBe(100);
		expect(split.bandCents).toBe(900);
	});
});

describe('the routed figures', () => {
	it('always reconciles: the band’s transfer plus the application fee is the charge', () => {
		for (const totalCents of [0, 200, 500, 1000, 1337, 5000]) {
			for (const coverFees of [false, true]) {
				for (const platformCents of [
					0,
					1,
					suggestedPlatformCents(totalCents, coverFees),
					divisibleCents(totalCents, coverFees)
				]) {
					const s = computeAudioSplit({ totalCents, platformCents, coverFees });
					const label = `${totalCents}/${platformCents}/${coverFees}`;
					// Nothing may fall between the two halves of the charge.
					expect(s.bandCents + s.applicationFeeCents, label).toBe(s.chargeCents);
					// And what CMC keeps is the application fee less Stripe's cut.
					expect(s.applicationFeeCents - s.stripeFeeCents, label).toBe(s.platformNetCents);
				}
			}
		}
	});

	it('charges nothing extra unless the buyer covers fees', () => {
		expect(
			computeAudioSplit({ totalCents: 1500, platformCents: 141, coverFees: false }).chargeCents
		).toBe(1500);
	});

	it('is a no-op on a free release', () => {
		const split = computeAudioSplit({ totalCents: 0, platformCents: 0, coverFees: false });
		expect(split.chargeCents).toBe(0);
		expect(split.applicationFeeCents).toBe(0);
		expect(split.bandCents).toBe(0);
	});
});

describe('the collective’s share stays refusable, all the way down', () => {
	it('costs the collective nothing at an allocation of zero', () => {
		const split = computeAudioSplit({ totalCents: 1000, platformCents: 0, coverFees: false });
		// The whole point: refusing the cut leaves CMC at break-even, never
		// out of pocket — which is why no minimum share is needed to be safe.
		expect(split.platformNetCents).toBe(0);
		expect(split.applicationFeeCents).toBe(split.stripeFeeCents);
		expect(split.bandCents).toBe(941);
	});

	it('needs no floor, so zero validates', () => {
		const result = validateSplit({
			totalCents: 1000,
			platformCents: 0,
			coverFees: false,
			priceMinCents: 1000,
			allowPayMore: true
		});
		expect(result.ok).toBe(true);
	});

	it('lets the buyer give the collective more than the default', () => {
		const split = computeAudioSplit({ totalCents: 1000, platformCents: 250, coverFees: false });
		expect(split.platformNetCents).toBeGreaterThan(defaultSplit(1000).platformNetCents);
		expect(split.bandCents).toBeLessThan(defaultSplit(1000).bandCents);
	});
});

describe('validateSplit', () => {
	const paid = { priceMinCents: 1000, allowPayMore: true };
	const free = { priceMinCents: 0, allowPayMore: true };

	it('accepts the default allocation', () => {
		const result = validateSplit({
			totalCents: 1000,
			platformCents: 94,
			coverFees: false,
			...paid
		});
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.split.bandCents).toBe(847);
	});

	it('refuses less than the band asked for', () => {
		const result = validateSplit({ totalCents: 500, platformCents: 0, coverFees: false, ...paid });
		expect(result).toMatchObject({ ok: false, reason: 'That is less than the band asked for.' });
	});

	it('refuses a negative allocation, which would pay the platform out of the band', () => {
		// The reason this is validated rather than clamped: these numbers become
		// `application_fee_amount`.
		expect(
			validateSplit({ totalCents: 1000, platformCents: -500, coverFees: false, ...paid })
		).toMatchObject({ ok: false });
		expect(
			validateSplit({ totalCents: -1000, platformCents: 0, coverFees: false, ...paid })
		).toMatchObject({ ok: false });
	});

	it('refuses an allocation that leaves the band nothing', () => {
		expect(
			validateSplit({ totalCents: 1000, platformCents: 1000, coverFees: false, ...paid })
		).toMatchObject({ ok: false, reason: 'That leaves the band nothing.' });
		// Exactly the divisible amount is the boundary: it pays the band $0, which
		// is not a sale anybody meant to make.
		expect(
			validateSplit({ totalCents: 1000, platformCents: 941, coverFees: false, ...paid })
		).toMatchObject({ ok: false, reason: 'That leaves the band nothing.' });
	});

	it('refuses fractional cents', () => {
		expect(
			validateSplit({ totalCents: 1000.5, platformCents: 94, coverFees: false, ...paid })
		).toMatchObject({ ok: false });
	});

	it('accepts a free release at zero, with no charge', () => {
		const result = validateSplit({ totalCents: 0, platformCents: 0, coverFees: false, ...free });
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.split.chargeCents).toBe(0);
	});

	it('refuses the dead zone between free and the charge floor', () => {
		// Stripe's own minimum is 50¢ and its fixed fee is 30¢: these are the
		// prices where almost nothing reaches the band.
		for (const totalCents of [1, 49, 99, AUDIO_MIN_PRICE_CENTS - 1]) {
			expect(
				validateSplit({ totalCents, platformCents: 0, coverFees: false, ...free }),
				`${totalCents}`
			).toMatchObject({ ok: false });
		}
	});

	it('lets a free release be paid for anyway, at or above the floor', () => {
		// Name-your-price from zero: a listener who wants to pay for a free record
		// should be able to.
		expect(
			validateSplit({ totalCents: 500, platformCents: 42, coverFees: false, ...free }).ok
		).toBe(true);
	});

	it('holds a fixed-price release to its price', () => {
		const fixed = { priceMinCents: 700, allowPayMore: false };
		expect(
			validateSplit({ totalCents: 700, platformCents: 63, coverFees: false, ...fixed }).ok
		).toBe(true);
		expect(
			validateSplit({ totalCents: 1200, platformCents: 63, coverFees: false, ...fixed })
		).toMatchObject({ ok: false, reason: 'This release has a fixed price.' });
	});

	it('recomputes the fee rather than believing a posted one', () => {
		// The caller passes no Stripe fee at all — there is nowhere for a client to
		// put one, which is the strongest form of not trusting it.
		const result = validateSplit({
			totalCents: 1000,
			platformCents: 94,
			coverFees: false,
			...paid
		});
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.split.stripeFeeCents).toBe(59);
	});
});
