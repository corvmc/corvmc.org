import type Stripe from 'stripe';
import { and, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { donation, type DonationStatus } from '#lib/server/db/schema/donation.js';
import { stripe } from '#lib/server/stripe.js';
import { DomainError } from '#lib/server/domain-error.js';
import { captureException } from '#lib/server/sentry.js';
import { openUnmatchedPaymentTask } from './unmatched-payment-task';
import { calculateCardPresentFee } from '#lib/finance/fees.js';
import { isOnTheDoor } from '#lib/server/ticket/door-sale.js';
import { recordEntries, type RecordEntryInput } from './financial-entry-service';
import { showProjectIdForEvent } from './show-project';

/** A door donation that cannot go ahead, in words the staffer can act on. */
export class DoorDonationError extends DomainError {
	readonly httpStatus = 409;
}

export interface DoorDonationStart {
	kind: 'card';
	eventId: string;
	paymentIntentId: string;
	clientSecret: string;
	chargeCents: number;
}

/**
 * Open a card-present intent for a gift at tonight's show (#2548). The row is
 * minted `pending` under the intent's id, as a door ticket is, so the webhook
 * has something to flip and the door screen something to poll.
 */
export async function startDoorDonation(input: {
	eventId: string;
	amountCents: number;
	staffUserId: string;
	now?: Date;
}): Promise<DoorDonationStart> {
	const { eventId, amountCents, staffUserId, now = new Date() } = input;
	if (!(await isOnTheDoor(eventId, now))) {
		throw new DoorDonationError('That show is not on the door');
	}
	const intent = await stripe.paymentIntents.create({
		amount: amountCents,
		currency: 'usd',
		payment_method_types: ['card_present'],
		capture_method: 'automatic',
		description: 'Donation at the door',
		metadata: {
			type: 'door_donation',
			event_id: eventId,
			staff_user_id: staffUserId,
			fee_cents: String(calculateCardPresentFee(amountCents))
		}
	});
	await db.insert(donation).values({
		paymentIntentId: intent.id,
		eventId,
		amountCents,
		takenByUserId: staffUserId
	});
	return {
		kind: 'card',
		eventId,
		paymentIntentId: intent.id,
		clientSecret: intent.client_secret ?? '',
		chargeCents: amountCents
	};
}

/** The gift as earned, and the card fee as spent, as the reservation and market rows are. */
export function doorDonationEntries(params: {
	paymentIntentId: string;
	chargeCents: number;
	feeCents: number;
	projectId: string | null;
	occurredAt: Date;
}): RecordEntryInput[] {
	const base = {
		occurredAt: params.occurredAt,
		settlement: 'stripe' as const,
		stripePaymentRecordId: params.paymentIntentId,
		subjectType: 'donation' as const,
		subjectId: params.paymentIntentId,
		projectId: params.projectId,
		userId: null
	};
	const entries: RecordEntryInput[] = [
		{
			...base,
			amountCents: params.chargeCents,
			kind: 'earned',
			category: 'donation',
			description: 'Donation, door, card present'
		}
	];
	if (params.feeCents > 0) {
		entries.push({
			...base,
			amountCents: -params.feeCents,
			kind: 'spent',
			category: 'card_fees',
			description: 'Card processing, in person'
		});
	}
	return entries;
}

/**
 * `payment_intent.succeeded` for a door gift. The conditional update is the
 * idempotency: a redelivered event matches no `pending` row and writes nothing.
 */
export async function fulfillDoorDonation(intent: Stripe.PaymentIntent): Promise<void> {
	const meta = intent.metadata ?? {};
	if (meta.type !== 'door_donation') return;

	const paidAt = new Date();
	const flipped = await db
		.update(donation)
		.set({ status: 'paid', paidAt })
		.where(and(eq(donation.paymentIntentId, intent.id), eq(donation.status, 'pending')))
		.returning({ eventId: donation.eventId });
	const [row] = flipped;
	if (!row) return;

	await recordEntries(
		doorDonationEntries({
			paymentIntentId: intent.id,
			chargeCents: intent.amount,
			feeCents: Number(meta.fee_cents) || 0,
			projectId: await showProjectIdForEvent(row.eventId ?? meta.event_id ?? null),
			occurredAt: paidAt
		})
	);
}

async function findDonation(paymentIntentId: string) {
	const [row] = await db
		.select({
			eventId: donation.eventId,
			status: donation.status,
			amountCents: donation.amountCents
		})
		.from(donation)
		.where(eq(donation.paymentIntentId, paymentIntentId))
		.limit(1);
	return row ?? null;
}

/** The staffer backed out before a tap. A charged card is money moved, and refuses. */
export async function cancelDoorDonation(paymentIntentId: string): Promise<void> {
	const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
	if (intent.metadata?.type !== 'door_donation') throw new DoorDonationError('Not a door donation');
	if (intent.status === 'succeeded') {
		throw new DoorDonationError('That card has already been charged');
	}
	if (intent.status !== 'canceled') await stripe.paymentIntents.cancel(paymentIntentId);
	await db
		.update(donation)
		.set({ status: 'cancelled' })
		.where(and(eq(donation.paymentIntentId, paymentIntentId), eq(donation.status, 'pending')));
}

/** The show a door gift was given at, which decides who may act on it. */
export async function doorDonationEventId(paymentIntentId: string): Promise<string | null> {
	return (await findDonation(paymentIntentId))?.eventId ?? null;
}

/** A read for the door screen to poll; null when the intent is not a door gift. */
export async function getDoorDonation(
	paymentIntentId: string
): Promise<{ status: DonationStatus; amountCents: number } | null> {
	const row = await findDonation(paymentIntentId);
	return row ? { status: row.status, amountCents: row.amountCents } : null;
}

/** The window `sweepDoorSales` uses, for the same reason. */
const SWEEP_WINDOW_MS = 48 * 3600_000;

export interface DoorDonationSweep {
	checked: number;
	fulfilled: string[];
	/** Charged with no pending row to flip: a staffer decides. */
	unmatched: string[];
}

/**
 * The backstop for a missed `payment_intent.succeeded` (#2547), for gifts. It
 * runs `fulfillDoorDonation`, the webhook's own writer, so nothing is written twice.
 */
export async function sweepDoorDonations(now = new Date()): Promise<DoorDonationSweep> {
	const result: DoorDonationSweep = { checked: 0, fulfilled: [], unmatched: [] };
	const createdGte = Math.floor((now.getTime() - SWEEP_WINDOW_MS) / 1000);
	let startingAfter: string | undefined;
	for (;;) {
		const page = await stripe.paymentIntents.list({
			created: { gte: createdGte },
			limit: 100,
			...(startingAfter ? { starting_after: startingAfter } : {})
		});
		for (const intent of page.data) {
			if (intent.status !== 'succeeded' || intent.metadata?.type !== 'door_donation') continue;
			result.checked++;
			const row = await findDonation(intent.id);
			if (row?.status === 'pending') {
				await fulfillDoorDonation(intent);
				result.fulfilled.push(intent.id);
			} else if (row?.status !== 'paid') {
				result.unmatched.push(intent.id);
				captureException(new Error('Door card donation has no pending record'), {
					event: 'door-donation.unmatched',
					paymentIntentId: intent.id,
					amountCents: intent.amount
				});
				await openUnmatchedPaymentTask({
					paymentIntentId: intent.id,
					kind: 'gift',
					amountCents: intent.amount,
					eventId: row?.eventId ?? intent.metadata?.event_id
				});
			}
		}
		if (!page.has_more || page.data.length === 0) break;
		startingAfter = page.data.at(-1)?.id;
	}
	return result;
}
