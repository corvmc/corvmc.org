import type Stripe from 'stripe';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { reservation } from '$lib/server/db/schema/reservation';
import { paymentCache } from '$lib/server/db/schema/finance';
import { stripe, paymentDriver } from '$lib/server/stripe';
import { DomainError } from '$lib/server/domain-error';
import { captureException } from '$lib/server/sentry';
import { terminalReaderId } from '$lib/server/finance/terminal-service';
import { recordReservationCardPresent } from '$lib/server/finance/reservation-entries';
import { announceConfirmed } from './reservation-service';

/** `metadata.type` on the intent, which is what the webhook dispatches on. */
export const READER_PAYMENT_TYPE = 'reader_reservation';

/** Stripe's smallest USD charge. Below it the reader is never engaged. */
export const READER_MIN_CHARGE_CENTS = 50;

const OPENS_BEFORE_START_MS = 2 * 3600_000;
/** An action older than this was abandoned by whoever started it, and is cleared. */
const STALE_ACTION_MS = 2 * 60_000;

/** A reader payment that cannot go ahead, in words the member can act on. */
export class ReaderPaymentError extends DomainError {
	readonly httpStatus = 409;
}

export class ReaderBusyError extends DomainError {
	readonly httpStatus = 409;
	constructor() {
		super('The reader is busy, try again in a minute');
	}
}

export class ReaderOfflineError extends DomainError {
	readonly httpStatus = 503;
	constructor(message = 'The reader is offline') {
		super(message);
	}
}

export class ReaderNotConfiguredError extends DomainError {
	readonly httpStatus = 503;
	constructor() {
		super('Paying at the reader is not set up');
	}
}

interface PayableRow {
	status: string;
	paidAt: Date | null;
	cashDueCents: number | null;
	startsAt: Date;
	endsAt: Date;
}

/**
 * Owed and on the day: `scheduled`, or `confirmed` with money still due, from
 * two hours before the start until the end. `cashDueCents: 0` without `paidAt`
 * is credit-settled, which owes nothing.
 */
export function readerPayable(row: PayableRow, now = new Date()): boolean {
	if (row.paidAt) return false;
	const owed =
		row.status === 'scheduled' ||
		(row.status === 'confirmed' && (row.cashDueCents == null || row.cashDueCents > 0));
	if (!owed) return false;
	const t = now.getTime();
	return t >= row.startsAt.getTime() - OPENS_BEFORE_START_MS && t < row.endsAt.getTime();
}

function requireReader(): string {
	const readerId = terminalReaderId();
	if (!readerId) throw new ReaderNotConfiguredError();
	return readerId;
}

const stripeCode = (err: unknown) => (err as { code?: string } | null)?.code;

const intentIdOf = (action: Stripe.Terminal.Reader.Action | null | undefined) => {
	const pi = action?.process_payment_intent?.payment_intent;
	return typeof pi === 'string' ? pi : (pi?.id ?? null);
};

async function currentAction(readerId: string) {
	const reader = await stripe.terminal.readers.retrieve(readerId);
	if ('deleted' in reader && reader.deleted) throw new ReaderNotConfiguredError();
	return (reader as Stripe.Terminal.Reader).action;
}

/**
 * One intent per booking and amount. A cancelled one cannot be reused, so the
 * next is keyed off it, which keeps a double tap after a cancel to one intent.
 */
async function intentFor(reservationId: string, userId: string, amountCents: number) {
	const params: Stripe.PaymentIntentCreateParams = {
		amount: amountCents,
		currency: 'usd',
		payment_method_types: ['card_present'],
		capture_method: 'automatic',
		description: 'Practice room',
		metadata: { type: READER_PAYMENT_TYPE, reservation_id: reservationId, user_id: userId }
	};
	let key = `reader-${reservationId}-${amountCents}`;
	let intent = await stripe.paymentIntents.create(params, { idempotencyKey: key });
	for (let i = 0; i < 5 && intent.status === 'canceled'; i++) {
		key = `${key}-${intent.id}`;
		intent = await stripe.paymentIntents.create(params, { idempotencyKey: key });
	}
	return intent;
}

async function processOnReader(readerId: string, intentId: string, retried = false) {
	try {
		await stripe.terminal.readers.processPaymentIntent(readerId, {
			payment_intent: intentId,
			process_config: { skip_tipping: true, enable_customer_cancellation: true }
		});
	} catch (err) {
		const code = stripeCode(err);
		if (code === 'terminal_reader_timeout' && !retried) {
			return processOnReader(readerId, intentId, true);
		}
		// A timeout can be a false negative: the first attempt landed after all.
		if (code === 'terminal_reader_busy') {
			if (intentIdOf(await currentAction(readerId)) === intentId) return;
			throw new ReaderBusyError();
		}
		if (code === 'terminal_reader_offline') throw new ReaderOfflineError();
		if (code === 'terminal_reader_timeout') {
			throw new ReaderOfflineError('The reader did not answer, try again in a moment');
		}
		throw err;
	}
}

/**
 * Put what the booking owes on the reader. The amount is the caller's, which
 * has already committed credits; this only refuses one too small to charge.
 */
export async function startReaderPayment(input: {
	reservationId: string;
	userId: string;
	amountCents: number;
	now?: Date;
}): Promise<{ paymentIntentId: string }> {
	const { reservationId, userId, amountCents, now = new Date() } = input;
	const readerId = requireReader();
	if (amountCents < READER_MIN_CHARGE_CENTS) {
		throw new ReaderPaymentError(
			'That is less than a card can be charged for. Staff can settle it with you instead'
		);
	}

	const intent = await intentFor(reservationId, userId, amountCents);
	if (intent.status === 'succeeded') return { paymentIntentId: intent.id };

	const action = await currentAction(readerId);
	if (action?.status === 'in_progress') {
		const otherId = intentIdOf(action);
		if (otherId === intent.id) return { paymentIntentId: intent.id };
		const other = otherId ? await stripe.paymentIntents.retrieve(otherId) : null;
		if (other && now.getTime() - other.created * 1000 < STALE_ACTION_MS) {
			throw new ReaderBusyError();
		}
		await stripe.terminal.readers.cancelAction(readerId);
	}

	await processOnReader(readerId, intent.id);
	return { paymentIntentId: intent.id };
}

/** A reader intent, checked against the booking it is being acted on for. */
async function readerIntent(paymentIntentId: string, reservationId: string) {
	const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
	const meta = intent.metadata ?? {};
	if (meta.type !== READER_PAYMENT_TYPE || meta.reservation_id !== reservationId) {
		throw new ReaderPaymentError('That payment is not for this booking');
	}
	return intent;
}

/** The phone's Cancel: clear the reader if it is on this intent, then the intent. */
export async function cancelReaderPayment(
	paymentIntentId: string,
	reservationId: string
): Promise<void> {
	const intent = await readerIntent(paymentIntentId, reservationId);
	if (intent.status === 'succeeded') {
		throw new ReaderPaymentError('That card has already been charged');
	}
	const readerId = terminalReaderId();
	if (readerId) {
		const action = await currentAction(readerId);
		if (action?.status === 'in_progress' && intentIdOf(action) === paymentIntentId) {
			await stripe.terminal.readers.cancelAction(readerId);
		}
	}
	if (intent.status !== 'canceled') await stripe.paymentIntents.cancel(paymentIntentId);
}

export type ReaderPaymentStatus =
	| { status: 'paid' }
	| { status: 'processing' }
	| { status: 'waiting' }
	| { status: 'declined'; message: string }
	| { status: 'cancelled' };

/** A read for the phone to poll. `paid` is the booking's, never the intent's word. */
export async function readerPaymentStatus(
	paymentIntentId: string,
	reservationId: string
): Promise<ReaderPaymentStatus> {
	const intent = await readerIntent(paymentIntentId, reservationId);
	const [row] = await db
		.select({ paidAt: reservation.paidAt, record: reservation.stripePaymentRecordId })
		.from(reservation)
		.where(eq(reservation.id, reservationId))
		.limit(1);
	if (row?.paidAt && row.record === paymentIntentId) return { status: 'paid' };
	if (intent.status === 'succeeded') return { status: 'processing' };
	if (intent.status === 'canceled') return { status: 'cancelled' };
	// A retry after a decline keeps the old error on the intent until the next card.
	const readerId = terminalReaderId();
	const action = readerId ? await currentAction(readerId) : null;
	if (action?.status === 'in_progress' && intentIdOf(action) === paymentIntentId) {
		return { status: 'waiting' };
	}
	if (intent.last_payment_error) {
		return {
			status: 'declined',
			message: intent.last_payment_error.message ?? 'The card was declined'
		};
	}
	return { status: 'waiting' };
}

async function cacheReaderPayment(intent: Stripe.PaymentIntent, userId: string, paidAt: Date) {
	try {
		await db.insert(paymentCache).values({
			id: intent.id,
			userId,
			reservationId: intent.metadata.reservation_id,
			stripeCustomerId: null,
			amountCents: intent.amount_received || intent.amount,
			currency: intent.currency ?? 'usd',
			paymentMethod: 'Card',
			status: 'completed',
			paidAt
		});
	} catch (err) {
		if (/UNIQUE constraint failed/i.test((err as Error).message ?? '')) return;
		captureException(err, { event: 'reader.cache', paymentIntentId: intent.id });
	}
}

/**
 * `payment_intent.succeeded` for a reader payment: the only writer. The
 * conditional update is the idempotency, so a redelivered event writes nothing.
 */
export async function settleReservationAtReader(intent: Stripe.PaymentIntent): Promise<void> {
	const meta = intent.metadata ?? {};
	if (meta.type !== READER_PAYMENT_TYPE || !meta.reservation_id) return;
	const reservationId = meta.reservation_id;

	const paidAt = new Date();
	const flipped = await db
		.update(reservation)
		.set({
			status: 'confirmed',
			paidAt,
			cashDueCents: 0,
			stripePaymentRecordId: intent.id,
			updatedAt: paidAt
		})
		.where(
			and(
				eq(reservation.id, reservationId),
				inArray(reservation.status, ['scheduled', 'confirmed']),
				isNull(reservation.paidAt)
			)
		)
		.returning({ userId: reservation.createdByUserId });

	if (flipped.length === 0) {
		const [row] = await db
			.select({ record: reservation.stripePaymentRecordId })
			.from(reservation)
			.where(eq(reservation.id, reservationId))
			.limit(1);
		// Money taken for a booking that was settled some other way needs a refund.
		if (row?.record !== intent.id) {
			captureException(new Error('Reader payment for a booking that was already settled'), {
				reservationId,
				paymentIntentId: intent.id
			});
		}
		return;
	}

	const userId = flipped[0].userId;
	const amountCents = intent.amount_received || intent.amount;
	await recordReservationCardPresent({
		reservationId,
		userId,
		amountCents,
		stripePaymentRecordId: intent.id,
		occurredAt: paidAt
	});
	await cacheReaderPayment(intent, userId, paidAt);
	await announceConfirmed(reservationId);
}

/**
 * A card presented to the reader without one. Under the fake there is no
 * webhook, so it settles here the way the webhook would; against a simulated
 * reader in test mode, Stripe sends the webhook itself.
 */
export async function simulateReaderTap(
	paymentIntentId: string,
	reservationId: string,
	outcome: 'succeed' | 'decline'
): Promise<void> {
	await readerIntent(paymentIntentId, reservationId);
	const readerId = requireReader();
	await stripe.testHelpers.terminal.readers.presentPaymentMethod(readerId, {
		card_present: { number: outcome === 'decline' ? '4000000000000002' : '4242424242424242' }
	});
	if (paymentDriver() !== 'fake') return;
	const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
	if (intent.status === 'succeeded') await settleReservationAtReader(intent);
}
