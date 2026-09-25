import { describe, it, expect } from 'vitest';
import {
	calculateCardPresentFee,
	calculateProcessingFee,
	calculateTotalWithFeeCoverage
} from './fees';

describe('calculateProcessingFee', () => {
	it('calculates fee for a $25 charge', () => {
		// $25.00 = 2500 cents → 2500 * 0.029 + 30 = 72.5 + 30 = 102.5 → 103 cents
		expect(calculateProcessingFee(2500)).toBe(103);
	});

	it('calculates fee for a $5 charge', () => {
		// 500 * 0.029 + 30 = 14.5 + 30 = 44.5 → 45 cents
		expect(calculateProcessingFee(500)).toBe(45);
	});

	it('returns 0 for zero amount', () => {
		expect(calculateProcessingFee(0)).toBe(0);
	});

	it('returns 0 for negative amount', () => {
		expect(calculateProcessingFee(-100)).toBe(0);
	});
});

describe('calculateTotalWithFeeCoverage', () => {
	it('calculates total so net equals base for $25', () => {
		const { totalCents, feeCents } = calculateTotalWithFeeCoverage(2500);

		// Verify: totalCents - fee(totalCents) >= baseCents
		const stripeFee = Math.ceil(totalCents * 0.029 + 30);
		expect(totalCents - stripeFee).toBeGreaterThanOrEqual(2500);

		// And the fee is the difference
		expect(feeCents).toBe(totalCents - 2500);
	});

	it('calculates total so net equals base for $5', () => {
		const { totalCents, feeCents } = calculateTotalWithFeeCoverage(500);

		const stripeFee = Math.ceil(totalCents * 0.029 + 30);
		expect(totalCents - stripeFee).toBeGreaterThanOrEqual(500);
		expect(feeCents).toBe(totalCents - 500);
	});

	it('returns zeros for zero base', () => {
		expect(calculateTotalWithFeeCoverage(0)).toEqual({ totalCents: 0, feeCents: 0 });
	});

	it('returns zeros for negative base', () => {
		expect(calculateTotalWithFeeCoverage(-100)).toEqual({ totalCents: 0, feeCents: 0 });
	});
});

describe('calculateCardPresentFee', () => {
	it('charges the in-person rate, not the online one', () => {
		// 2.7% + 5¢ on $20 is 59¢, where online would be 88¢.
		expect(calculateCardPresentFee(2000)).toBe(59);
		expect(calculateCardPresentFee(2000)).toBeLessThan(calculateProcessingFee(2000));
	});

	it('charges nothing on nothing', () => {
		expect(calculateCardPresentFee(0)).toBe(0);
	});
});
