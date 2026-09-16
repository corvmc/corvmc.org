import { calculateProcessingFee } from '$lib/finance/fees';
import { listForSubject, recordEntries, type RecordEntryInput } from './financial-entry-service';

/**
 * A band's premium subscription, in the ledger's terms (#1179).
 *
 * Its own category rather than `membership`: a report can merge two lines, and
 * nothing can split one. The payer is a band, not a member.
 */

export interface BandPremiumInvoice {
	bandId: string;
	invoiceId: string;
	amountCents: number;
}

/**
 * Written from `invoice.paid` only, never from the checkout.
 *
 * Stripe fires `checkout.session.completed` **and** `invoice.paid` for a
 * subscription's first charge, so recording at both would double the opening
 * cycle. The invoice covers the first charge and every renewal with one code
 * path, and its id is the idempotency key.
 */
export async function recordBandPremiumInvoice(invoice: BandPremiumInvoice): Promise<void> {
	if (invoice.amountCents <= 0 || !invoice.invoiceId) return;

	const already = await listForSubject('band_premium', invoice.invoiceId);
	if (already.length > 0) return;

	const feeCents = calculateProcessingFee(invoice.amountCents);
	const occurredAt = new Date();

	const base = {
		occurredAt,
		settlement: 'stripe' as const,
		// The invoice, not the PaymentIntent this column is documented to hold.
		stripePaymentRecordId: null,
		subjectType: 'band_premium' as const,
		subjectId: invoice.invoiceId,
		metadata: { bandId: invoice.bandId, invoiceId: invoice.invoiceId }
	};

	const entries: RecordEntryInput[] = [
		{
			...base,
			amountCents: invoice.amountCents,
			kind: 'earned',
			category: 'band_premium',
			description: 'Band premium subscription'
		}
	];

	if (feeCents > 0) {
		entries.push({
			...base,
			amountCents: -feeCents,
			kind: 'spent',
			category: 'card_fees',
			description: 'Card processing'
		});
	}

	await recordEntries(entries);
}
