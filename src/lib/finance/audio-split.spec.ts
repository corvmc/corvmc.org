import { describe, it, expect } from 'vitest';
import { computeSplit, defaultSplit, validateSplit, suggestedPlatformCents } from './audio-split';
import { AUDIO_MIN_PRICE_CENTS } from '$lib/config';

/**
 * The one number in this feature that must not diverge: what the buyer is shown,
 * what Stripe is told, and what the band is paid are all this module's output.
 * A second implementation anywhere would eventually show one figure and pay
 * another.
 *
 * The table below is the agreed commercial model, to the cent.
 */
describe('the agreed model, at the default position', () => {
	it('shares the card fee in proportion to each side’s take', () => {
		const split = defaultSplit(1000, false);

		expect(split.chargeCents).toBe(1000);
		expect(split.stripeFeeCents).toBe(59); // 2.9% + 30¢
		expect(split.platformCents).toBe(100);

		// 90% of the sale, so 90% of the fee: 53¢ of 59¢.
		expect(split.bandFeeCents).toBe(53);
		expect(split.platformFeeShareCents).toBe(6);
		expect(split.bandCents).toBe(847);
		expect(split.platformNetCents).toBe(94);

		// Whatever is left of the charge once the band is paid.
		expect(split.applicationFeeCents).toBe(153);
	});

	it('lets both sides keep their whole allocation when the buyer covers fees', () => {
		const split = defaultSplit(1000, true);

		expect(split.chargeCents).toBe(1061);
		expect(split.feeCoveredCents).toBe(61);
		// The surcharge has already paid the fee, so neither side absorbs any.
		expect(split.bandFeeCents).toBe(0);
		expect(split.bandCents).toBe(900);
		expect(split.platformNetCents).toBe(100);
	});
});

describe('computeSplit', () => {
	it('always reconciles: band + platform + stripe equals the charge', () => {
		// The property that makes a rounding gap impossible. `bandCents` is derived
		// from the charge rather than computed independently for this reason.
		for (const totalCents of [200, 333, 500, 999, 1000, 1234, 5000, 99_999]) {
			for (const coverFees of [false, true]) {
				for (const platformCents of [0, 1, suggestedPlatformCents(totalCents), totalCents]) {
					const s = computeSplit({ totalCents, platformCents, coverFees });
					// Band plus what Stripe is told is exactly the charge.
					expect(s.bandCents + s.applicationFeeCents).toBe(s.chargeCents);
					// And the three real destinations account for every cent of it.
					expect(s.bandCents + s.platformNetCents + s.stripeFeeCents).toBe(s.chargeCents);
					// The fee is fully apportioned — no half-cent lost to rounding.
					expect(s.bandFeeCents + s.platformFeeShareCents).toBe(s.stripeFeeCents);
				}
			}
		}
	});

	it('charges nothing extra unless the buyer covers fees', () => {
		expect(
			computeSplit({ totalCents: 1500, platformCents: 150, coverFees: false }).chargeCents
		).toBe(1500);
	});

	it('is a no-op on a free release', () => {
		const split = computeSplit({ totalCents: 0, platformCents: 0, coverFees: false });
		expect(split).toMatchObject({ chargeCents: 0, applicationFeeCents: 0, bandCents: 0 });
	});
});

describe('the collective’s share stays refusable, all the way down', () => {
	it('costs the collective nothing at an allocation of zero', () => {
		const split = computeSplit({ totalCents: 1000, platformCents: 0, coverFees: false });

		// The property proportional splitting buys: no share means no share of the
		// fee, so CMC nets exactly zero rather than paying to sell the record.
		// An even split would have owed it half the fee here.
		expect(split.platformFeeShareCents).toBe(0);
		expect(split.platformNetCents).toBe(0);
		expect(split.bandFeeCents).toBe(split.stripeFeeCents);
		expect(split.bandCents).toBe(1000 - split.stripeFeeCents);
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

	it('gives the collective the whole fee when the buyer gives it the whole sale', () => {
		// The mirror of the above, and why the band's floor is a separate rule.
		const split = computeSplit({ totalCents: 1000, platformCents: 1000, coverFees: false });
		expect(split.bandFeeCents).toBe(0);
		expect(split.platformFeeShareCents).toBe(split.stripeFeeCents);
	});

	it('lets the buyer give the collective more than the default', () => {
		const split = computeSplit({ totalCents: 1000, platformCents: 250, coverFees: false });
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
			platformCents: 100,
			coverFees: false,
			...paid
		});
		expect(result.ok).toBe(true);
	});

	it('refuses less than the band asked for', () => {
		const result = validateSplit({ totalCents: 500, platformCents: 0, coverFees: false, ...paid });
		expect(result).toMatchObject({ ok: false });
	});

	it('accepts the band’s asking price exactly', () => {
		expect(
			validateSplit({ totalCents: 1000, platformCents: 100, coverFees: false, ...paid }).ok
		).toBe(true);
	});

	it('refuses a negative allocation, which would pay the platform out of the band', () => {
		// These numbers become `application_fee_amount`. A client posting -500 is
		// the attack this exists to stop.
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
		).toMatchObject({ ok: false });
	});

	it('refuses fractional cents', () => {
		expect(
			validateSplit({ totalCents: 1000.5, platformCents: 100, coverFees: false, ...paid })
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
			validateSplit({ totalCents: 500, platformCents: 50, coverFees: false, ...free }).ok
		).toBe(true);
	});

	it('holds a fixed-price release to its price', () => {
		const fixed = { priceMinCents: 700, allowPayMore: false };
		expect(
			validateSplit({ totalCents: 700, platformCents: 70, coverFees: false, ...fixed }).ok
		).toBe(true);
		expect(
			validateSplit({ totalCents: 1200, platformCents: 70, coverFees: false, ...fixed })
		).toMatchObject({ ok: false });
	});

	it('recomputes the fee rather than believing a posted one', () => {
		// The caller passes no Stripe fee at all — there is nowhere for a client to
		// put one, which is the strongest form of not trusting it.
		const result = validateSplit({
			totalCents: 1000,
			platformCents: 100,
			coverFees: false,
			...paid
		});
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.split.stripeFeeCents).toBe(59);
	});
});
