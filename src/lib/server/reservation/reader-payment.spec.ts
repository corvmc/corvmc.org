import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Stripe from 'stripe';

/** Paying for a booking at the smart reader, against a real SQLite and the fake gateway. */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

vi.mock('$lib/server/db', () => ({ db: testDb }));
vi.mock('$env/dynamic/private', () => ({ env: {} }));

const announceConfirmed = vi.fn(async () => undefined);
vi.mock('./reservation-service', () => ({
	announceConfirmed: (...a: unknown[]) => announceConfirmed(...(a as []))
}));

const recordReservationCardPresent = vi.fn(async () => undefined);
vi.mock('$lib/server/finance/reservation-entries', () => ({
	recordReservationCardPresent: (...a: unknown[]) => recordReservationCardPresent(...(a as []))
}));

const captureException = vi.fn();
vi.mock('$lib/server/sentry', () => ({
	captureException: (...a: unknown[]) => captureException(...a)
}));

const { initStripe, stripe } = await import('$lib/server/stripe');
const { createFakeGateway, resetFakeGateway, FAKE_TERMINAL_READER_ID } =
	await import('$lib/server/finance/gateway/fake-gateway');
const {
	readerPayable,
	startReaderPayment,
	cancelReaderPayment,
	readerPaymentStatus,
	settleReservationAtReader,
	simulateReaderTap,
	ReaderBusyError,
	ReaderOfflineError,
	ReaderPaymentError,
	READER_PAYMENT_TYPE
} = await import('./reader-payment');

const NOW = new Date('2026-09-29T18:00:00Z');
const secs = (d: Date) => Math.floor(d.getTime() / 1000);
const HOUR = 3600_000;

function booking(over: { id?: string; status?: string; paidAt?: number | null } = {}) {
	const id = over.id ?? 'res-1';
	sqlite
		.prepare(
			`insert into reservation (id, booker_type, booker_id, created_by_user_id, status, starts_at, ends_at, paid_at)
			 values (?, 'user', 'user-1', 'user-1', ?, ?, ?, ?)`
		)
		.run(
			id,
			over.status ?? 'scheduled',
			secs(new Date(NOW.getTime() + 30 * 60_000)),
			secs(new Date(NOW.getTime() + 2.5 * HOUR)),
			over.paidAt ?? null
		);
	return id;
}

const row = (id = 'res-1') =>
	sqlite
		.prepare(
			`select status, paid_at, cash_due_cents, stripe_payment_record_id from reservation where id = ?`
		)
		.get(id) as Record<string, unknown>;

const cacheRows = () =>
	sqlite.prepare(`select id, reservation_id, amount_cents from payment_cache`).all();

const start = (over: Partial<Parameters<typeof startReaderPayment>[0]> = {}) =>
	startReaderPayment({
		reservationId: 'res-1',
		userId: 'user-1',
		amountCents: 1500,
		now: NOW,
		...over
	});

const readerAction = async () => {
	const reader = (await stripe.terminal.readers.retrieve(
		FAKE_TERMINAL_READER_ID
	)) as Stripe.Terminal.Reader;
	return reader.action;
};

function stripeError(code: string): Error {
	return Object.assign(new Error(code), { name: 'StripeInvalidRequestError', code });
}

beforeEach(() => {
	for (const table of ['payment_cache', 'reservation', 'user']) sqlite.exec(`delete from ${table}`);
	sqlite.exec(
		`insert into user (id, name, email, email_verified, created_at, updated_at)
		 values ('user-1', 'Member', 'member@example.com', 0, unixepoch(), unixepoch())`
	);
	resetFakeGateway();
	initStripe(createFakeGateway());
	vi.clearAllMocks();
});

describe('when a booking can be paid at the reader', () => {
	const base = {
		status: 'scheduled' as const,
		paidAt: null,
		cashDueCents: null,
		startsAt: new Date(NOW.getTime() + HOUR),
		endsAt: new Date(NOW.getTime() + 3 * HOUR)
	};

	it('opens two hours before the start and closes at the end', () => {
		expect(readerPayable(base, NOW)).toBe(true);
		expect(readerPayable({ ...base, startsAt: new Date(NOW.getTime() + 3 * HOUR) }, NOW)).toBe(
			false
		);
		expect(
			readerPayable({ ...base, endsAt: NOW, startsAt: new Date(NOW.getTime() - HOUR) }, NOW)
		).toBe(false);
	});

	it('needs something owed: not paid, not credit-settled, not cancelled', () => {
		expect(readerPayable({ ...base, status: 'confirmed', cashDueCents: 700 }, NOW)).toBe(true);
		expect(readerPayable({ ...base, status: 'confirmed', cashDueCents: 0 }, NOW)).toBe(false);
		expect(readerPayable({ ...base, paidAt: NOW }, NOW)).toBe(false);
		expect(readerPayable({ ...base, status: 'cancelled' }, NOW)).toBe(false);
	});
});

describe('starting a payment at the reader', () => {
	it('creates a card-present intent and puts it on the reader, with tipping off', async () => {
		const processSpy = vi.spyOn(stripe.terminal.readers, 'processPaymentIntent');
		const { paymentIntentId } = await start();

		const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
		expect(intent).toMatchObject({
			amount: 1500,
			payment_method_types: ['card_present'],
			capture_method: 'automatic',
			metadata: { type: READER_PAYMENT_TYPE, reservation_id: 'res-1', user_id: 'user-1' }
		});
		expect(processSpy).toHaveBeenCalledWith(FAKE_TERMINAL_READER_ID, {
			payment_intent: paymentIntentId,
			process_config: { skip_tipping: true, enable_customer_cancellation: true }
		});
		expect(await readerAction()).toMatchObject({ status: 'in_progress' });
	});

	it('keys the intent on the booking and amount, so a double tap makes one intent', async () => {
		const createSpy = vi.spyOn(stripe.paymentIntents, 'create');
		const first = await start();
		const second = await start();
		expect(second.paymentIntentId).toBe(first.paymentIntentId);
		expect(createSpy.mock.calls[0][1]).toEqual({ idempotencyKey: 'reader-res-1-1500' });
	});

	it('leaves the reader alone when it is already waiting on this intent', async () => {
		const { paymentIntentId } = await start();
		const processSpy = vi.spyOn(stripe.terminal.readers, 'processPaymentIntent');
		const cancelSpy = vi.spyOn(stripe.terminal.readers, 'cancelAction');
		await expect(start()).resolves.toEqual({ paymentIntentId });
		expect(processSpy).not.toHaveBeenCalled();
		expect(cancelSpy).not.toHaveBeenCalled();
	});

	it('refuses while another payment is fresh on the reader', async () => {
		await start({ reservationId: 'res-other', userId: 'user-2' });
		await expect(start({ now: new Date(Date.now() + 30_000) })).rejects.toBeInstanceOf(
			ReaderBusyError
		);
	});

	it('clears an abandoned payment older than two minutes, and takes the reader', async () => {
		const other = await start({ reservationId: 'res-other', userId: 'user-2' });
		const cancelSpy = vi.spyOn(stripe.terminal.readers, 'cancelAction');
		const { paymentIntentId } = await start({ now: new Date(Date.now() + 3 * 60_000) });
		expect(cancelSpy).toHaveBeenCalledWith(FAKE_TERMINAL_READER_ID);
		expect(paymentIntentId).not.toBe(other.paymentIntentId);
		expect(await readerAction()).toMatchObject({
			status: 'in_progress',
			process_payment_intent: { payment_intent: paymentIntentId }
		});
	});

	it('reports an offline reader as a 503, not a crash', async () => {
		vi.spyOn(stripe.terminal.readers, 'processPaymentIntent').mockRejectedValue(
			stripeError('terminal_reader_offline')
		);
		const err = await start().catch((e) => e);
		expect(err).toBeInstanceOf(ReaderOfflineError);
		expect(err.httpStatus).toBe(503);
	});

	it('retries a timeout once, since Stripe reports false negatives on it', async () => {
		const real = stripe.terminal.readers.processPaymentIntent;
		const spy = vi
			.spyOn(stripe.terminal.readers, 'processPaymentIntent')
			.mockRejectedValueOnce(stripeError('terminal_reader_timeout'))
			.mockImplementationOnce(real);
		await expect(start()).resolves.toBeDefined();
		expect(spy).toHaveBeenCalledTimes(2);
	});

	it('refuses an amount under the card minimum without touching the reader', async () => {
		const createSpy = vi.spyOn(stripe.paymentIntents, 'create');
		await expect(start({ amountCents: 30 })).rejects.toBeInstanceOf(ReaderPaymentError);
		expect(createSpy).not.toHaveBeenCalled();
	});

	it('makes a fresh intent after the member cancelled the last one', async () => {
		booking();
		const first = await start();
		await cancelReaderPayment(first.paymentIntentId, 'res-1');
		const second = await start();
		expect(second.paymentIntentId).not.toBe(first.paymentIntentId);
		expect((await stripe.paymentIntents.retrieve(first.paymentIntentId)).status).toBe('canceled');
	});
});

describe('settling at the reader', () => {
	async function tap(reservationId = 'res-1') {
		const { paymentIntentId } = await start({ reservationId });
		await stripe.testHelpers.terminal.readers.presentPaymentMethod(FAKE_TERMINAL_READER_ID);
		return stripe.paymentIntents.retrieve(paymentIntentId);
	}

	it('confirms and marks the booking paid, then records it and announces it', async () => {
		booking();
		const intent = await tap();
		await settleReservationAtReader(intent);

		expect(row()).toMatchObject({
			status: 'confirmed',
			cash_due_cents: 0,
			stripe_payment_record_id: intent.id
		});
		expect(row().paid_at).not.toBeNull();
		expect(recordReservationCardPresent).toHaveBeenCalledWith(
			expect.objectContaining({
				reservationId: 'res-1',
				userId: 'user-1',
				amountCents: 1500,
				stripePaymentRecordId: intent.id
			})
		);
		expect(cacheRows()).toEqual([{ id: intent.id, reservation_id: 'res-1', amount_cents: 1500 }]);
		expect(announceConfirmed).toHaveBeenCalledWith('res-1');
	});

	it('settles once and records once when Stripe delivers the event twice', async () => {
		booking();
		const intent = await tap();
		await settleReservationAtReader(intent);
		await settleReservationAtReader(intent);
		expect(recordReservationCardPresent).toHaveBeenCalledTimes(1);
		expect(announceConfirmed).toHaveBeenCalledTimes(1);
		expect(cacheRows()).toHaveLength(1);
	});

	it('ignores a door sale', async () => {
		booking();
		const intent = await tap();
		await settleReservationAtReader({ ...intent, metadata: { type: 'door_ticket' } });
		expect(row().status).toBe('scheduled');
		expect(recordReservationCardPresent).not.toHaveBeenCalled();
	});

	it('writes nothing for a booking already paid, and says so', async () => {
		booking({ status: 'confirmed', paidAt: secs(NOW) });
		const intent = await tap();
		await settleReservationAtReader(intent);
		expect(row().stripe_payment_record_id).toBeNull();
		expect(recordReservationCardPresent).not.toHaveBeenCalled();
		expect(captureException).toHaveBeenCalledTimes(1);
	});

	it('under the fake, a simulated tap settles without a webhook', async () => {
		booking();
		const { paymentIntentId } = await start();
		await simulateReaderTap(paymentIntentId, 'res-1', 'succeed');
		expect(row().status).toBe('confirmed');
		expect(await readerPaymentStatus(paymentIntentId, 'res-1')).toMatchObject({ status: 'paid' });
	});
});

describe('what the phone reads', () => {
	it('waits, then reads a decline as something to try again', async () => {
		booking();
		const { paymentIntentId } = await start();
		expect(await readerPaymentStatus(paymentIntentId, 'res-1')).toMatchObject({
			status: 'waiting'
		});
		await simulateReaderTap(paymentIntentId, 'res-1', 'decline');
		expect(await readerPaymentStatus(paymentIntentId, 'res-1')).toMatchObject({
			status: 'declined'
		});
		expect(row().status).toBe('scheduled');
	});

	it('refuses an intent that belongs to another booking', async () => {
		booking();
		const { paymentIntentId } = await start({ reservationId: 'res-other' });
		await expect(readerPaymentStatus(paymentIntentId, 'res-1')).rejects.toBeInstanceOf(
			ReaderPaymentError
		);
		await expect(cancelReaderPayment(paymentIntentId, 'res-1')).rejects.toBeInstanceOf(
			ReaderPaymentError
		);
	});

	it('cancels: clears the reader and the intent', async () => {
		booking();
		const { paymentIntentId } = await start();
		await cancelReaderPayment(paymentIntentId, 'res-1');
		expect((await readerAction())?.status).not.toBe('in_progress');
		expect(await readerPaymentStatus(paymentIntentId, 'res-1')).toMatchObject({
			status: 'cancelled'
		});
	});
});
