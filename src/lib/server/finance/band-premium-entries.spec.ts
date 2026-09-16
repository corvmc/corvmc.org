import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A band's premium subscription, recorded apart from a member's contribution.
 *
 * Its own category is the decision #1179 records: a report can merge two lines
 * and nothing can split one, so the distinction has to exist at collection.
 */

const recordEntries = vi.fn<(inputs: Record<string, unknown>[]) => Promise<void>>(
	async () => undefined
);
let existing: unknown[] = [];
vi.mock('./financial-entry-service', () => ({
	recordEntries: (...a: unknown[]) => recordEntries(...(a as [Record<string, unknown>[]])),
	listForSubject: async () => existing
}));

const { recordBandPremiumInvoice } = await import('./band-premium-entries');

const invoice = (over: Record<string, unknown> = {}) => ({
	bandId: 'band-1',
	invoiceId: 'in_band_1',
	amountCents: 1200,
	...over
});

const written = () => recordEntries.mock.calls[0]?.[0] ?? [];

beforeEach(() => {
	vi.clearAllMocks();
	existing = [];
});

describe('a paid band premium invoice', () => {
	it('earns under its own category, never membership', async () => {
		await recordBandPremiumInvoice(invoice());

		const earned = written().find((e) => e.kind === 'earned');
		expect(earned).toMatchObject({
			amountCents: 1200,
			category: 'band_premium',
			subjectType: 'band_premium',
			subjectId: 'in_band_1'
		});
		expect(earned?.category).not.toBe('membership');
	});

	it('keeps the band on the row, since the subject is the invoice', async () => {
		await recordBandPremiumInvoice(invoice());
		for (const entry of written()) {
			expect(entry.metadata).toMatchObject({ bandId: 'band-1' });
		}
	});

	it('records the card fee as spend', async () => {
		await recordBandPremiumInvoice(invoice());
		const fee = written().find((e) => e.kind === 'spent');

		expect(fee).toMatchObject({ category: 'card_fees' });
		expect(fee?.amountCents as number).toBeLessThan(0);
	});
});

describe('what it refuses to write', () => {
	it('writes nothing twice for one invoice', async () => {
		// Stripe fires checkout.session.completed AND invoice.paid for a
		// subscription's first charge; writing from both would double the opening
		// cycle, which is why only the invoice path calls this.
		existing = [{ id: 'entry-1' }];
		await recordBandPremiumInvoice(invoice());
		expect(recordEntries).not.toHaveBeenCalled();
	});

	it('writes nothing for a zero invoice', async () => {
		await recordBandPremiumInvoice(invoice({ amountCents: 0 }));
		expect(recordEntries).not.toHaveBeenCalled();
	});

	it('writes nothing without an invoice id to be idempotent on', async () => {
		await recordBandPremiumInvoice(invoice({ invoiceId: '' }));
		expect(recordEntries).not.toHaveBeenCalled();
	});
});
