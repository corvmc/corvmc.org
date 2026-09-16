import {
	listForSubject,
	recordEntries,
	reverseEntriesForSubject,
	type RecordEntryInput
} from './financial-entry-service';
import type { AudioPurchasedEvent } from '$lib/server/event-bus/event-bus';

/**
 * A music sale, in the ledger's terms (#1175).
 *
 * On `audio.purchased` rather than in the checkout entries listener, whose
 * `else` swallowed it — and which the free-download path, written already
 * paid, would never have reached anyway.
 */

/**
 * **The band's share is not a pass-through.** A release is a Connect
 * destination charge: Stripe moves `bandNetCents` to the band's own account at
 * the moment of sale and the collective never holds it. Recording it here
 * would put money the collective cannot spend on its books.
 */
export async function recordAudioSale(event: AudioPurchasedEvent): Promise<void> {
	if (event.amountPaidCents <= 0) return;

	const already = await listForSubject('audio_purchase', event.purchaseId);
	if (already.length > 0) return;

	// `applicationFeeCents` is what Stripe hands the collective, gross;
	// `platformFeeCents` is what it keeps after its share of card processing
	// (`audio-split.ts:52`). The difference is that share, and it is real spend.
	const applicationFeeCents = event.amountPaidCents - event.bandNetCents;
	const cardFeeCents = applicationFeeCents - event.platformFeeCents;
	if (applicationFeeCents <= 0) return;

	const occurredAt = new Date();
	const base = {
		occurredAt,
		settlement: 'stripe' as const,
		// The event carries no payment record, and an audio refund never reaches
		// the `refund()` that would look one up — `refundPurchase` reverses the
		// transfer and the application fee on the charge instead.
		stripePaymentRecordId: null,
		subjectType: 'audio_purchase' as const,
		subjectId: event.purchaseId,
		metadata: { releaseSlug: event.releaseSlug, bandSlug: event.bandSlug }
	};

	const entries: RecordEntryInput[] = [
		{
			...base,
			amountCents: applicationFeeCents,
			kind: 'earned',
			category: 'music_sales',
			description: `${event.releaseTitle} — ${event.bandName}`
		}
	];

	if (cardFeeCents > 0) {
		entries.push({
			...base,
			amountCents: -cardFeeCents,
			kind: 'spent',
			category: 'card_fees',
			description: 'Card processing'
		});
	}

	await recordEntries(entries);
}

/**
 * Giving a music sale back.
 *
 * `refundPurchase` reverses the transfer and refunds the application fee, so
 * both legs above come back. Keyed on the subject because the Connect path
 * never writes a payment record to key on.
 */
export async function recordAudioRefund(purchaseId: string): Promise<void> {
	await reverseEntriesForSubject('audio_purchase', purchaseId);
}
