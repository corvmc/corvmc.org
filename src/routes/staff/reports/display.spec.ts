import { describe, it, expect } from 'vitest';
import { shownCents } from './display';

// The ledger stores outflows negative; a figure labelled "Spent" already says
// the money went out, so the page shows it as a magnitude (#1832).
describe('shownCents', () => {
	it('shows spend as a positive amount', () => {
		expect(shownCents('spent', -3371)).toBe(3371);
	});

	it('leaves a net refund under Spent visibly negative', () => {
		expect(shownCents('spent', 500)).toBe(-500);
	});

	it('leaves every other kind as the ledger signs it', () => {
		expect(shownCents('earned', 916_407)).toBe(916_407);
		expect(shownCents('in_kind', 50_000)).toBe(50_000);
		expect(shownCents('pass_through', -700)).toBe(-700);
	});
});
