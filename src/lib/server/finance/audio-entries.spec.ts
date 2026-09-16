import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AudioPurchasedEvent } from '$lib/server/event-bus/event-bus';

/**
 * What a music sale writes, and the one figure it must not.
 *
 * A release is a Connect destination charge, so the band's share never sits in
 * the collective's balance. #1175 is this being absent entirely; the band leg
 * is the way it would most plausibly be got wrong once present.
 */

const recordEntries = vi.fn<(inputs: Record<string, unknown>[]) => Promise<void>>(
	async () => undefined
);
const reverseEntriesForSubject = vi.fn(async () => 0);
let existing: unknown[] = [];
vi.mock('./financial-entry-service', () => ({
	recordEntries: (...a: unknown[]) => recordEntries(...(a as [Record<string, unknown>[]])),
	reverseEntriesForSubject: (...a: unknown[]) => reverseEntriesForSubject(...(a as [])),
	listForSubject: async () => existing
}));

const { recordAudioSale, recordAudioRefund } = await import('./audio-entries');

/** $10 release: the band takes 900, Stripe's cut is 59, the collective keeps 41. */
const sale = (over: Partial<AudioPurchasedEvent> = {}): AudioPurchasedEvent =>
	({
		purchaseId: 'pur-1',
		downloadToken: 'tok-1',
		buyerEmail: 'buyer@example.com',
		releaseTitle: 'Bridge Sessions',
		releaseSlug: 'bridge-sessions',
		bandName: 'The Willamettes',
		bandSlug: 'the-willamettes',
		amountPaidCents: 1000,
		platformFeeCents: 41,
		bandNetCents: 900,
		...over
	}) as AudioPurchasedEvent;

const written = () => recordEntries.mock.calls[0]?.[0] ?? [];

beforeEach(() => {
	vi.clearAllMocks();
	existing = [];
});

describe('a music sale', () => {
	it('earns the application fee, which is the charge less the band', async () => {
		await recordAudioSale(sale());

		expect(written().find((e) => e.kind === 'earned')).toMatchObject({
			amountCents: 100,
			category: 'music_sales',
			subjectType: 'audio_purchase',
			subjectId: 'pur-1'
		});
	});

	it("spends the collective's share of card processing", async () => {
		// platformFeeCents is already net of it (audio-split.ts:52), so the fee is
		// the gap between the application fee and what the collective keeps.
		await recordAudioSale(sale());

		expect(written().find((e) => e.kind === 'spent')).toMatchObject({
			amountCents: -59,
			category: 'card_fees'
		});
	});

	it('leaves the collective keeping exactly platformFeeCents', async () => {
		await recordAudioSale(sale());
		expect(written().reduce((t, e) => t + (e.amountCents as number), 0)).toBe(41);
	});

	it("never records the band's share", async () => {
		// A destination charge moves it to the band's own account at the moment of
		// sale. Entering it would put money on the books the collective cannot
		// spend, and would double the sale's apparent revenue.
		await recordAudioSale(sale());

		for (const entry of written()) {
			expect(entry.amountCents).not.toBe(900);
		}
		expect(written()).toHaveLength(2);
	});

	it('writes nothing for a free download', async () => {
		// The free path inserts a paid row with every amount zero and emits the
		// same event, so the guard has to be on the amount rather than the path.
		await recordAudioSale(sale({ amountPaidCents: 0, platformFeeCents: 0, bandNetCents: 0 }));
		expect(recordEntries).not.toHaveBeenCalled();
	});

	it('writes nothing when the collective took nothing', async () => {
		await recordAudioSale(sale({ platformFeeCents: 0, bandNetCents: 1000 }));
		expect(recordEntries).not.toHaveBeenCalled();
	});

	it('writes nothing twice for one purchase', async () => {
		existing = [{ id: 'entry-1' }];
		await recordAudioSale(sale());
		expect(recordEntries).not.toHaveBeenCalled();
	});

	it('omits the fee leg when there is nothing to spend', async () => {
		await recordAudioSale(sale({ platformFeeCents: 100 }));
		expect(written()).toHaveLength(1);
	});
});

describe('a refunded music sale', () => {
	it('reverses on the subject, which is the key a Connect refund leaves', async () => {
		// `refundPurchase` reverses the transfer and the application fee on the
		// charge and never reaches the `refund()` that writes a payment record.
		await recordAudioRefund('pur-1');
		expect(reverseEntriesForSubject).toHaveBeenCalledWith('audio_purchase', 'pur-1');
	});
});
