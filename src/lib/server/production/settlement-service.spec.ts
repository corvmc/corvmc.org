import { describe, it, expect } from 'vitest';
import { payoutForDeal } from './settlement-service';

/**
 * The deal arithmetic, which is the part that decides what an act is handed.
 * `getSettlement`'s queries are covered by the aggregates they call.
 */
describe('what a deal pays', () => {
	const base = { shareBaseCents: 84_000, contributed: false };

	it('pays a percentage of the pool when that is the whole deal', () => {
		expect(
			payoutForDeal({ ...base, guaranteeCents: null, percentageBps: 3333, versus: false })
		).toBe(27_997);
	});

	it('pays a flat fee when there is no percentage', () => {
		expect(
			payoutForDeal({ ...base, guaranteeCents: 20_000, percentageBps: null, versus: false })
		).toBe(20_000);
	});

	it('adds them when the deal is a guarantee PLUS a percentage', () => {
		expect(
			payoutForDeal({ ...base, guaranteeCents: 20_000, percentageBps: 2500, versus: false })
		).toBe(41_000);
	});

	it('takes the greater when the deal is guarantee VERSUS percentage', () => {
		// The industry sense of "versus", and the reason the column exists.
		expect(
			payoutForDeal({ ...base, guaranteeCents: 40_000, percentageBps: 2500, versus: true })
		).toBe(40_000);
		expect(
			payoutForDeal({ ...base, guaranteeCents: 10_000, percentageBps: 2500, versus: true })
		).toBe(21_000);
	});

	it('pays nothing for a donated set, whatever the numbers say', () => {
		// Zero and zero on purpose — which is why `contributed` cannot be inferred
		// from the amounts, and why it wins over them here.
		expect(
			payoutForDeal({
				...base,
				guaranteeCents: 50_000,
				percentageBps: 5000,
				versus: false,
				contributed: true
			})
		).toBe(0);
	});

	it('pays the guarantee on a night that took nothing', () => {
		// The soft-night case: the pool is empty and the act is still owed.
		expect(
			payoutForDeal({
				shareBaseCents: 0,
				contributed: false,
				guaranteeCents: 40_000,
				percentageBps: 5000,
				versus: true
			})
		).toBe(40_000);
	});
});
