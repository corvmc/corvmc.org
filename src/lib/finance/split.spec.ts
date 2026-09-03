import { describe, it, expect } from 'vitest';
import { computeSplit, suggestedShareCents, validateSplit } from './split';

/**
 * The one arithmetic in a payment split that must not diverge: what the buyer is
 * shown, what is recorded, and what anyone is eventually paid are all this
 * module's output. A second implementation anywhere would eventually show one
 * figure and pay another.
 */
describe('computeSplit', () => {
	it('always reconciles: share + remainder + stripe equals the charge', () => {
		// The property that makes a rounding gap impossible. `remainderCents` is
		// derived from the charge rather than computed independently for this
		// reason.
		for (const totalCents of [200, 333, 500, 999, 1000, 1234, 5000, 99_999]) {
			for (const coverFees of [false, true]) {
				const fee = computeSplit({ totalCents, shareCents: 0, coverFees }).stripeFeeCents;
				for (const shareCents of [
					0,
					1,
					suggestedShareCents(totalCents - fee, 3000),
					totalCents - fee
				]) {
					const s = computeSplit({ totalCents, shareCents, coverFees });
					expect(s.shareCents + s.remainderCents + s.stripeFeeCents).toBe(s.chargeCents);
				}
			}
		}
	});

	it('charges nothing extra unless the buyer covers fees', () => {
		expect(computeSplit({ totalCents: 1500, shareCents: 150, coverFees: false }).chargeCents).toBe(
			1500
		);
	});

	it('grosses the charge up when the buyer covers fees, and says by how much', () => {
		const split = computeSplit({ totalCents: 1000, shareCents: 100, coverFees: true });
		expect(split.chargeCents).toBe(1061);
		expect(split.feeCoveredCents).toBe(61);
		// The whole $10 survives the card: $10.61 charged, 61¢ to Stripe, $1 to the
		// share, $9 left over.
		expect(split.stripeFeeCents).toBe(61);
		expect(split.remainderCents).toBe(900);
	});

	it('takes the card fee off the top, not out of one party', () => {
		const split = computeSplit({ totalCents: 1000, shareCents: 300, coverFees: false });
		expect(split.stripeFeeCents).toBe(59); // 2.9% + 30¢
		expect(split.shareCents).toBe(300);
		expect(split.remainderCents).toBe(641);
	});

	it('is a no-op at zero', () => {
		expect(computeSplit({ totalCents: 0, shareCents: 0, coverFees: false })).toMatchObject({
			chargeCents: 0,
			remainderCents: 0,
			stripeFeeCents: 0
		});
	});
});

describe('suggestedShareCents', () => {
	it('is a share of what is divisible, so the caller subtracts the fee first', () => {
		// 30% of $10 is $3.00; 30% of what is actually left to divide is $2.82.
		// Naming the second is the honest one — the fee is paid before anyone is.
		expect(suggestedShareCents(1000, 3000)).toBe(300);
		expect(suggestedShareCents(1000 - 59, 3000)).toBe(282);
	});

	it('is zero when there is nothing to divide', () => {
		expect(suggestedShareCents(0, 3000)).toBe(0);
		expect(suggestedShareCents(-100, 3000)).toBe(0);
	});
});

describe('the allocated share is refusable', () => {
	it('goes to zero, leaving the whole net to the other party', () => {
		const split = computeSplit({ totalCents: 1000, shareCents: 0, coverFees: false });
		expect(split.remainderCents).toBe(1000 - split.stripeFeeCents);
	});

	it('goes above the suggestion just as freely', () => {
		const split = computeSplit({ totalCents: 1000, shareCents: 500, coverFees: false });
		expect(split.remainderCents).toBe(1000 - 500 - split.stripeFeeCents);
	});
});

describe('validateSplit', () => {
	const paid = { priceMinCents: 1000, minChargeCents: 200, allowPayMore: true };
	const free = { priceMinCents: 0, minChargeCents: 200, allowPayMore: true };

	it('accepts an allocation at the floor', () => {
		expect(validateSplit({ totalCents: 1000, shareCents: 100, coverFees: false, ...paid }).ok).toBe(
			true
		);
	});

	it('refuses less than the asking price', () => {
		expect(
			validateSplit({ totalCents: 500, shareCents: 0, coverFees: false, ...paid })
		).toMatchObject({ ok: false });
	});

	it('refuses a negative allocation, which would pay one party out of the other', () => {
		// A client posting -500 is the attack this exists to stop.
		expect(
			validateSplit({ totalCents: 1000, shareCents: -500, coverFees: false, ...paid })
		).toMatchObject({ ok: false });
		expect(
			validateSplit({ totalCents: -1000, shareCents: 0, coverFees: false, ...paid })
		).toMatchObject({ ok: false });
	});

	it('refuses an allocation that leaves the other party nothing', () => {
		expect(
			validateSplit({ totalCents: 1000, shareCents: 1000, coverFees: false, ...paid })
		).toMatchObject({ ok: false });
	});

	it('refuses fractional cents', () => {
		expect(
			validateSplit({ totalCents: 1000.5, shareCents: 100, coverFees: false, ...paid })
		).toMatchObject({ ok: false });
	});

	it('accepts free at zero, with no charge', () => {
		const result = validateSplit({ totalCents: 0, shareCents: 0, coverFees: false, ...free });
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.split.chargeCents).toBe(0);
	});

	it('refuses the dead zone between free and the charge floor', () => {
		for (const totalCents of [1, 49, 99, 199]) {
			expect(
				validateSplit({ totalCents, shareCents: 0, coverFees: false, ...free }),
				`${totalCents}`
			).toMatchObject({ ok: false });
		}
	});

	it('names the charge floor in the refusal, so the buyer knows where to go', () => {
		const result = validateSplit({ totalCents: 100, shareCents: 0, coverFees: false, ...free });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toContain('$2.00');
	});

	it('takes overridden copy from the caller', () => {
		const result = validateSplit({
			totalCents: 100,
			shareCents: 0,
			coverFees: false,
			...free,
			messages: { deadZone: (c) => `at least ${c} cents please` }
		});
		expect(result).toMatchObject({ ok: false, reason: 'at least 200 cents please' });
	});

	it('lets a free thing be paid for anyway, at or above the charge floor', () => {
		expect(validateSplit({ totalCents: 500, shareCents: 50, coverFees: false, ...free }).ok).toBe(
			true
		);
	});

	it('holds a fixed price to its price', () => {
		const fixed = { priceMinCents: 700, minChargeCents: 200, allowPayMore: false };
		expect(validateSplit({ totalCents: 700, shareCents: 70, coverFees: false, ...fixed }).ok).toBe(
			true
		);
		expect(
			validateSplit({ totalCents: 1200, shareCents: 70, coverFees: false, ...fixed })
		).toMatchObject({ ok: false });
	});

	it('recomputes the fee rather than believing a posted one', () => {
		// The caller passes no Stripe fee at all — there is nowhere for a client to
		// put one, which is the strongest form of not trusting it.
		const result = validateSplit({ totalCents: 1000, shareCents: 100, coverFees: false, ...paid });
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.split.stripeFeeCents).toBe(59);
	});
});
