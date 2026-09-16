import { calculateProcessingFee } from '$lib/finance/fees';
import { listForSubject, recordEntries, type RecordEntryInput } from './financial-entry-service';
import type { MembershipPaymentEvent } from '$lib/server/event-bus/event-bus';

/**
 * A paid contribution invoice, in the ledger's terms.
 *
 * The backfill wrote `membership` rows from Stripe and no live path replaced
 * it, so the record has drifted every month since (#1172). A listener rather
 * than a call inside `handleInvoicePaid`: the webhook already emits the event
 * with the amount on it, and the accounting stays in the finance module where
 * `no-direct-financial-entry-writes` can see it.
 */

/**
 * The charge, and the card fee that came out of it.
 *
 * Two legs, as `reservation` does and unlike a ticket: when the member covered
 * processing, the surcharge is inside `amountCents` and nets correctly against
 * the fee, but it is not separately queryable under `fee_coverage`. Splitting
 * it needs the covered amount on the event, which carries only a boolean.
 */
export async function recordMembershipInvoice(event: MembershipPaymentEvent): Promise<void> {
	if (event.amountCents <= 0 || !event.invoiceId) return;

	// Stripe retries a webhook, and `invoice.paid` is the one event that would
	// otherwise double a month's revenue. Keyed on the invoice for the same
	// reason `allocateCreditsFromInvoice` is.
	const already = await listForSubject('membership', event.invoiceId);
	if (already.length > 0) return;

	const feeCents = calculateProcessingFee(event.amountCents);
	const occurredAt = new Date();

	const base = {
		occurredAt,
		settlement: 'stripe' as const,
		// The event carries the invoice, not the PaymentIntent this column is
		// documented to hold, so it stays null rather than holding something a
		// refund reversal would look up and mis-join. The invoice is in metadata.
		stripePaymentRecordId: null,
		subjectType: 'membership' as const,
		subjectId: event.invoiceId,
		userId: event.userId,
		metadata: { invoiceId: event.invoiceId, coveringFees: event.coveringFees }
	};

	const entries: RecordEntryInput[] = [
		{
			...base,
			amountCents: event.amountCents,
			kind: 'earned',
			category: 'membership',
			description: `Sustaining contribution — ${event.userName}`
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
