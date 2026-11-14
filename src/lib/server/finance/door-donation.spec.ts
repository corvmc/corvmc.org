import { describe, it, expect, beforeEach, vi } from 'vitest';

/** Door donations against a real SQLite, with the real ledger, and the fake gateway for Stripe. */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));
vi.mock('$app/env/private', async () => (await import('#lib/testing/env-mock.js')).envMock({}));

const captureException = vi.fn();
vi.mock('#lib/server/sentry.js', () => ({
	captureException: (...a: unknown[]) => captureException(...a)
}));

const { initStripe, stripe } = await import('#lib/server/stripe.js');
const { createFakeGateway, resetFakeGateway, completeFakeTerminalPayment } =
	await import('#lib/server/finance/gateway/fake-gateway.js');
const { calculateCardPresentFee } = await import('#lib/finance/fees.js');
const { handlePaymentIntentSucceeded } = await import('./webhook-handlers');
const {
	startDoorDonation,
	fulfillDoorDonation,
	cancelDoorDonation,
	getDoorDonation,
	doorDonationEventId,
	sweepDoorDonations,
	DoorDonationError
} = await import('./door-donation');

const NOW = new Date('2026-09-24T19:00:00Z');
const at = (hoursFromNow: number) => Math.floor(NOW.getTime() / 1000) + hoursFromNow * 3600;

function listing(id: string, startsAt: number) {
	sqlite.exec(
		`insert into event_listing (id, title, starts_at, ends_at, status, source, kind, created_by_user_id)
		 values ('${id}', 'Show ${id}', ${startsAt}, ${startsAt + 10800}, 'published', 'cmc', 'show', 'staff-1')`
	);
}

const ledger = (pi: string) =>
	sqlite
		.prepare(
			`select amount_cents, kind, category, settlement, subject_type, stripe_payment_record_id
			   from financial_entry where subject_id = ? order by amount_cents desc`
		)
		.all(pi) as Record<string, unknown>[];

const status = (pi: string) =>
	(
		sqlite.prepare('select status from donation where payment_intent_id = ?').get(pi) as
			{ status: string } | undefined
	)?.status;

async function start(amountCents = 5000) {
	return startDoorDonation({ eventId: 'tonight', amountCents, staffUserId: 'staff-1', now: NOW });
}

beforeEach(() => {
	for (const table of ['work_order', 'financial_entry', 'donation', 'event_listing'])
		sqlite.exec(`delete from ${table}`);
	resetFakeGateway();
	initStripe(createFakeGateway());
	vi.clearAllMocks();
	listing('tonight', at(1));
});

describe('door donations', () => {
	it('opens a card-present intent for the amount and holds a pending record', async () => {
		const gift = await start();
		const intent = await stripe.paymentIntents.retrieve(gift.paymentIntentId);
		expect(intent).toMatchObject({
			amount: 5000,
			payment_method_types: ['card_present'],
			metadata: { type: 'door_donation', event_id: 'tonight', staff_user_id: 'staff-1' }
		});
		expect(status(gift.paymentIntentId)).toBe('pending');
		expect(await doorDonationEventId(gift.paymentIntentId)).toBe('tonight');
		expect(ledger(gift.paymentIntentId)).toEqual([]);
	});

	it('refuses a show that is not on the door, before opening an intent', async () => {
		listing('next-week', at(24 * 7));
		await expect(
			startDoorDonation({ eventId: 'next-week', amountCents: 5000, staffUserId: 's', now: NOW })
		).rejects.toBeInstanceOf(DoorDonationError);
		expect(sqlite.prepare('select count(*) as n from donation').get()).toEqual({ n: 0 });
	});

	it('records the gift and the card fee once the webhook lands, and only once', async () => {
		const gift = await start();
		const paid = completeFakeTerminalPayment(gift.paymentIntentId);
		await handlePaymentIntentSucceeded(paid);
		await handlePaymentIntentSucceeded(paid);

		expect(status(gift.paymentIntentId)).toBe('paid');
		const fee = calculateCardPresentFee(5000);
		expect(ledger(gift.paymentIntentId)).toEqual([
			{
				amount_cents: 5000,
				kind: 'earned',
				category: 'donation',
				settlement: 'stripe',
				subject_type: 'donation',
				stripe_payment_record_id: gift.paymentIntentId
			},
			{
				amount_cents: -fee,
				kind: 'spent',
				category: 'card_fees',
				settlement: 'stripe',
				subject_type: 'donation',
				stripe_payment_record_id: gift.paymentIntentId
			}
		]);
		expect(await getDoorDonation(gift.paymentIntentId)).toEqual({
			status: 'paid',
			amountCents: 5000
		});
	});

	it('cancels an untapped donation and writes nothing to the ledger', async () => {
		const gift = await start();
		await cancelDoorDonation(gift.paymentIntentId);
		expect(status(gift.paymentIntentId)).toBe('cancelled');
		expect((await stripe.paymentIntents.retrieve(gift.paymentIntentId)).status).toBe('canceled');
		expect(ledger(gift.paymentIntentId)).toEqual([]);
	});

	it('refuses to cancel a charged donation: the money has moved', async () => {
		const gift = await start();
		await fulfillDoorDonation(completeFakeTerminalPayment(gift.paymentIntentId));
		await expect(cancelDoorDonation(gift.paymentIntentId)).rejects.toBeInstanceOf(
			DoorDonationError
		);
		expect(status(gift.paymentIntentId)).toBe('paid');
		expect(ledger(gift.paymentIntentId)).toHaveLength(2);
	});

	it('the sweep records a charged donation whose webhook never came, once', async () => {
		const gift = await start();
		completeFakeTerminalPayment(gift.paymentIntentId);

		const first = await sweepDoorDonations();
		const second = await sweepDoorDonations();
		expect(first.fulfilled).toEqual([gift.paymentIntentId]);
		expect(second).toMatchObject({ checked: 1, fulfilled: [], unmatched: [] });
		expect(ledger(gift.paymentIntentId)).toHaveLength(2);
	});

	it('the sweep reports a charged donation whose record was cancelled, and writes nothing', async () => {
		const gift = await start();
		sqlite.exec(
			`update donation set status = 'cancelled' where payment_intent_id = '${gift.paymentIntentId}'`
		);
		completeFakeTerminalPayment(gift.paymentIntentId);

		const sweep = await sweepDoorDonations();
		expect(sweep.unmatched).toEqual([gift.paymentIntentId]);
		expect(captureException).toHaveBeenCalledTimes(1);
		expect(ledger(gift.paymentIntentId)).toEqual([]);
	});

	it('an unmatched donation opens one task, which a closed task never reopens (#2757)', async () => {
		const gift = await start();
		sqlite.exec(
			`update donation set status = 'cancelled' where payment_intent_id = '${gift.paymentIntentId}'`
		);
		completeFakeTerminalPayment(gift.paymentIntentId);
		const tasks = () =>
			sqlite
				.prepare(`select source_id, resolved_at from work_order where source = 'door_payment'`)
				.all();

		await sweepDoorDonations();
		await sweepDoorDonations();
		expect(tasks()).toEqual([{ source_id: gift.paymentIntentId, resolved_at: null }]);

		sqlite.exec(`update work_order set resolved_at = unixepoch() where source = 'door_payment'`);
		await sweepDoorDonations();
		expect(tasks()).toHaveLength(1);
		// The task is all it writes: the gift and the ledger are as the sweep left them.
		expect(ledger(gift.paymentIntentId)).toEqual([]);
		expect(
			sqlite
				.prepare(`select status from donation where payment_intent_id = ?`)
				.get(gift.paymentIntentId)
		).toEqual({ status: 'cancelled' });
	});
});
