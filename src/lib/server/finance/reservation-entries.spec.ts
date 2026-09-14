import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A reservation earns whether it settles in cash or in credits, and the two
 * must not merge: `stripeSettledCents` sums what actually cleared, so a
 * credit-covered hour counted as cash would never reconcile.
 */

const recordEntry = vi.fn(async () => undefined);
vi.mock('./financial-entry-service', () => ({
	recordEntry: (...a: unknown[]) => recordEntry(...(a as [])),
	recordEntries: vi.fn()
}));

const { recordReservationCredit, recordReservationCash } = await import('./reservation-entries');

const OCCURRED = new Date('2026-09-13T19:00:00Z');
beforeEach(() => vi.clearAllMocks());

describe('reservation settlement entries', () => {
	it('records the credit-covered half as earned, settled in credit', async () => {
		await recordReservationCredit({
			reservationId: 'res-1',
			userId: 'user-1',
			creditDiscountCents: 1500,
			occurredAt: OCCURRED
		});

		expect(recordEntry).toHaveBeenCalledWith(
			expect.objectContaining({
				amountCents: 1500,
				kind: 'earned',
				category: 'reservation',
				settlement: 'credit',
				subjectType: 'reservation',
				subjectId: 'res-1'
			})
		);
	});

	it('records the cash half against the payment record', async () => {
		await recordReservationCash({
			reservationId: 'res-1',
			userId: 'user-1',
			amountCents: 500,
			stripePaymentRecordId: 'pr_1',
			occurredAt: OCCURRED
		});

		expect(recordEntry).toHaveBeenCalledWith(
			expect.objectContaining({
				amountCents: 500,
				settlement: 'cash',
				// What a refund reverses on, and what a Stripe cross-check joins on.
				stripePaymentRecordId: 'pr_1'
			})
		);
	});

	// A booking wholly covered by credits owes no cash, and a $0 row would
	// claim a payment that never happened.
	it.each([
		['credit', () => recordReservationCredit],
		['cash', () => recordReservationCash]
	])('writes nothing for a zero %s amount', async (_kind, get) => {
		const fn = get();
		await (fn as (p: Record<string, unknown>) => Promise<void>)({
			reservationId: 'res-1',
			userId: 'user-1',
			creditDiscountCents: 0,
			amountCents: 0,
			stripePaymentRecordId: 'pr_1',
			occurredAt: OCCURRED
		});

		expect(recordEntry).not.toHaveBeenCalled();
	});
});
