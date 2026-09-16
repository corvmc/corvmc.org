import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MembershipPaymentEvent } from '$lib/server/event-bus/event-bus';

/**
 * What a paid contribution invoice writes.
 *
 * The regression this file exists for is the one in #1172: the backfill wrote
 * `membership` rows, no live path replaced it, and the record drifted from
 * Stripe every month without anything going red.
 */

const recordEntries = vi.fn<(inputs: Record<string, unknown>[]) => Promise<void>>(
	async () => undefined
);
let existing: unknown[] = [];
vi.mock('./financial-entry-service', () => ({
	recordEntries: (...a: unknown[]) => recordEntries(...(a as [Record<string, unknown>[]])),
	listForSubject: async () => existing
}));

const { recordMembershipInvoice } = await import('./membership-entries');

const invoice = (over: Partial<MembershipPaymentEvent> = {}): MembershipPaymentEvent =>
	({
		userId: 'user-1',
		userName: 'Sam Reyes',
		userEmail: 'sam@example.com',
		amountCents: 2500,
		freeHoursPerMonth: 5,
		periodEnd: '2026-10-16T00:00:00.000Z',
		invoiceId: 'in_123',
		coveringFees: false,
		...over
	}) as MembershipPaymentEvent;

/** The rows of the one `recordEntries` call, for readability below. */
const written = () => recordEntries.mock.calls[0]?.[0] ?? [];

beforeEach(() => {
	vi.clearAllMocks();
	existing = [];
});

describe('a paid contribution invoice', () => {
	it('records the charge as earned membership revenue', async () => {
		await recordMembershipInvoice(invoice());

		const earned = written().find((e) => e.kind === 'earned');
		expect(earned).toMatchObject({
			amountCents: 2500,
			category: 'membership',
			settlement: 'stripe',
			subjectType: 'membership',
			subjectId: 'in_123',
			userId: 'user-1'
		});
	});

	it('records the card fee as spend, whoever funded it', async () => {
		// The collective's share is already net of it, so an uncovered fee that
		// wrote nothing would make card processing queryable only for the members
		// who ticked the box. Same rule as a ticket sale.
		await recordMembershipInvoice(invoice({ coveringFees: false }));
		const fee = written().find((e) => e.kind === 'spent');

		expect(fee).toMatchObject({ category: 'card_fees' });
		expect(fee?.amountCents as number).toBeLessThan(0);
	});

	it('writes both legs in one call', async () => {
		await recordMembershipInvoice(invoice());
		expect(recordEntries).toHaveBeenCalledTimes(1);
		expect(written()).toHaveLength(2);
	});

	it('leaves stripePaymentRecordId null and keeps the invoice in metadata', async () => {
		// The column is documented as the PaymentIntent and the event carries an
		// invoice. Holding the wrong id there would let a refund reversal join on
		// something that is not the payment record.
		await recordMembershipInvoice(invoice());

		for (const entry of written()) {
			expect(entry.stripePaymentRecordId).toBeNull();
			expect(entry.metadata).toMatchObject({ invoiceId: 'in_123' });
		}
	});
});

describe('what it refuses to write', () => {
	it('writes nothing twice for one invoice', async () => {
		// Stripe retries a webhook, and this is the one event where that would
		// double a month's revenue.
		existing = [{ id: 'entry-1' }];
		await recordMembershipInvoice(invoice());
		expect(recordEntries).not.toHaveBeenCalled();
	});

	it('writes nothing for a zero invoice', async () => {
		// A fully discounted cycle still emits the event for the receipt.
		await recordMembershipInvoice(invoice({ amountCents: 0 }));
		expect(recordEntries).not.toHaveBeenCalled();
	});

	it('writes nothing without an invoice id to be idempotent on', async () => {
		await recordMembershipInvoice(invoice({ invoiceId: '' }));
		expect(recordEntries).not.toHaveBeenCalled();
	});
});
