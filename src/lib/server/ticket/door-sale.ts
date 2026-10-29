import type Stripe from 'stripe';
import { and, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { eventListing } from '$lib/server/db/schema/event';
import { ticket, ticketSale } from '$lib/server/db/schema/ticket';
import { stripe } from '$lib/server/stripe';
import { DomainError } from '$lib/server/domain-error';
import { doorTicketSplit } from '$lib/finance/ticket-split';
import { recordDoorTicketSale, recordFreeTicketSale } from '$lib/server/finance/ticket-entries';
import {
	cancelPurchase,
	createTickets,
	getTicketsByPurchase,
	getTicketsSold
} from './ticket-service';

/** A door sale that cannot go ahead, in words the staffer can act on. */
export class DoorSaleError extends DomainError {
	readonly httpStatus = 409;
}

/** A show is at the door from 24 hours before it starts until 12 hours after. */
const DOOR_BEFORE_MS = 24 * 3600_000;
const DOOR_AFTER_MS = 12 * 3600_000;

export interface DoorEvent {
	id: string;
	title: string;
	startsAt: Date;
	/** Where the scale opens. 0 when the show is free. */
	suggestedCents: number;
	floorCents: number;
	/** Null is unlimited. Negative once the door has sold past capacity (#1631). */
	remaining: number | null;
	/** Whether a buyer can pay on their own phone instead of tapping. */
	onlineSales: boolean;
}

/**
 * Collective-sold shows only: a band's own gig is its money (#1629). A listing
 * with no `ticket_sale` row is still a door the collective works.
 */
function doorEvents(now: Date) {
	return db
		.select({
			id: eventListing.id,
			title: eventListing.title,
			startsAt: eventListing.startsAt,
			priceCents: ticketSale.priceCents,
			floorCents: ticketSale.priceFloorCents,
			quantity: ticketSale.quantity,
			enabled: ticketSale.enabled
		})
		.from(eventListing)
		.leftJoin(ticketSale, eq(ticketSale.eventListingId, eventListing.id))
		.where(
			and(
				eq(eventListing.source, 'cmc'),
				eq(eventListing.status, 'published'),
				isNull(ticketSale.groupId),
				gte(eventListing.startsAt, new Date(now.getTime() - DOOR_AFTER_MS)),
				lte(eventListing.startsAt, new Date(now.getTime() + DOOR_BEFORE_MS))
			)
		)
		.orderBy(eventListing.startsAt);
}

type DoorEventRow = Awaited<ReturnType<typeof doorEvents>>[number];

async function toDoorEvent(row: DoorEventRow): Promise<DoorEvent> {
	const remaining = row.quantity == null ? null : row.quantity - (await getTicketsSold(row.id));
	return {
		id: row.id,
		title: row.title,
		startsAt: row.startsAt,
		suggestedCents: row.priceCents ?? 0,
		floorCents: row.floorCents ?? 0,
		remaining,
		onlineSales: row.enabled ?? false
	};
}

/** Whether the door screen offers this show right now. */
export async function isOnTheDoor(eventId: string, now = new Date()): Promise<boolean> {
	return (await doorEvents(now)).some((e) => e.id === eventId);
}

export async function listDoorEvents(now = new Date()): Promise<DoorEvent[]> {
	return Promise.all((await doorEvents(now)).map(toDoorEvent));
}

export type DoorSaleStart =
	| { kind: 'free'; purchaseId: string; quantity: number }
	| {
			kind: 'card';
			eventId: string;
			paymentIntentId: string;
			clientSecret: string;
			chargeCents: number;
	  };

/**
 * Price a door sale and either let them in free or open a card-present intent.
 *
 * The rows are minted `pending` under the intent's id, as online checkout
 * mints them before the redirect, so the seats are held during the tap and
 * `payment_intent.succeeded` has something to flip.
 */
export async function startDoorSale(input: {
	eventId: string;
	quantity: number;
	unitPriceCents: number;
	staffUserId: string;
	now?: Date;
}): Promise<DoorSaleStart> {
	const { eventId, quantity, unitPriceCents, staffUserId, now = new Date() } = input;
	const row = (await doorEvents(now)).find((e) => e.id === eventId);
	if (!row) throw new DoorSaleError('That show is not on sale at the door');
	const event = await toDoorEvent(row);

	if (unitPriceCents < event.floorCents) {
		throw new DoorSaleError(`Each ticket is at least $${(event.floorCents / 100).toFixed(2)}`);
	}

	const split = doorTicketSplit({
		unitPriceCents,
		quantity,
		suggestedUnitCents: event.suggestedCents
	});
	const tickets = {
		eventId,
		quantity,
		attendeeName: 'Door sale',
		attendeeEmail: '',
		unitPriceCents: split.ticketLineUnitCents,
		contributionCents: split.contributionCents,
		actsCents: split.actsCents,
		collectiveCents: split.collectiveCents
	};

	if (split.chargeCents === 0) {
		const purchaseId = `door-${crypto.randomUUID()}`;
		await createTickets({
			...tickets,
			purchaseId,
			status: 'checked_in',
			checkedInByUserId: staffUserId
		});
		await recordFreeTicketSale({ purchaseId, eventId, quantity, occurredAt: now });
		return { kind: 'free', purchaseId, quantity };
	}

	const intent = await stripe.paymentIntents.create({
		amount: split.chargeCents,
		currency: 'usd',
		payment_method_types: ['card_present'],
		capture_method: 'automatic',
		description: `Door: ${quantity} × ${event.title}`,
		metadata: {
			type: 'door_ticket',
			event_id: eventId,
			quantity: String(quantity),
			staff_user_id: staffUserId,
			acts_cents: String(split.actsCents),
			collective_cents: String(split.collectiveCents),
			fee_cents: String(split.feeCents)
		}
	});
	await createTickets({ ...tickets, purchaseId: intent.id, status: 'pending' });
	return {
		kind: 'card',
		eventId,
		paymentIntentId: intent.id,
		clientSecret: intent.client_secret ?? '',
		chargeCents: split.chargeCents
	};
}

/**
 * `payment_intent.succeeded` for a door sale: the only thing that checks the
 * order in. The conditional update is the idempotency: a redelivered event
 * matches no `pending` row, so it writes nothing and records nothing twice.
 */
export async function fulfillDoorSale(intent: Stripe.PaymentIntent): Promise<void> {
	const meta = intent.metadata ?? {};
	if (meta.type !== 'door_ticket') return;

	const checkedInAt = new Date();
	const flipped = await db
		.update(ticket)
		.set({
			status: 'checked_in',
			stripePaymentRecordId: intent.id,
			checkedInAt,
			checkedInByUserId: meta.staff_user_id || null,
			updatedAt: checkedInAt
		})
		.where(and(eq(ticket.purchaseId, intent.id), eq(ticket.status, 'pending')))
		.returning({ id: ticket.id });
	if (flipped.length === 0) return;

	await recordDoorTicketSale({
		purchaseId: intent.id,
		eventId: meta.event_id ?? '',
		chargeCents: intent.amount,
		actsCents: Number(meta.acts_cents) || 0,
		collectiveCents: Number(meta.collective_cents) || 0,
		feeCents: Number(meta.fee_cents) || 0,
		occurredAt: checkedInAt
	});
}

/** The staffer backed out before a tap: release the intent and the seats. */
export async function cancelDoorSale(paymentIntentId: string): Promise<void> {
	const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
	if (intent.metadata?.type !== 'door_ticket') throw new DoorSaleError('Not a door sale');
	if (intent.status === 'succeeded') throw new DoorSaleError('That card has already been charged');
	if (intent.status !== 'canceled') await stripe.paymentIntents.cancel(paymentIntentId);
	await cancelPurchase(paymentIntentId);
}

/**
 * The show a door sale was for, which decides who may act on it: null when the
 * id is not a door purchase. Online purchase ids are bare UUIDs, never `pi_`.
 */
export async function doorSaleEventId(purchaseId: string): Promise<string | null> {
	if (!purchaseId.startsWith('pi_')) return null;
	const [row] = await getTicketsByPurchase(purchaseId);
	return row?.eventId ?? null;
}

export type DoorSaleStatus = 'pending' | 'paid' | 'cancelled';

/** A read for the door screen to poll; it never writes. */
export async function getDoorSale(
	purchaseId: string
): Promise<{ status: DoorSaleStatus; quantity: number }> {
	const rows = await getTicketsByPurchase(purchaseId);
	const live = rows.filter((r) => r.status !== 'cancelled');
	if (live.length === 0) return { status: 'cancelled', quantity: 0 };
	const paid = live.every((r) => r.status === 'checked_in');
	return { status: paid ? 'paid' : 'pending', quantity: live.length };
}

/** A show's door takings, by how they were paid. There is no cash path at the door. */
export interface DoorTakings {
	card: { tickets: number; grossCents: number };
	free: { tickets: number };
}

/**
 * Summed from the door's own ticket rows: card sales are keyed on their `pi_`
 * intent, free let-ins on `door-`. Live rows only, so an untapped or cancelled
 * sale counts nothing. As sold: a refund is made in Stripe, which this cannot see.
 */
export async function getEventDoorTakings(eventId: string): Promise<DoorTakings> {
	const card = sql`substr(${ticket.purchaseId}, 1, 3) = 'pi_'`;
	const free = sql`substr(${ticket.purchaseId}, 1, 5) = 'door-'`;
	const [row] = await db
		.select({
			cardTickets: sql<number>`coalesce(sum(case when ${card} then 1 else 0 end), 0)`,
			cardGrossCents: sql<number>`coalesce(sum(case when ${card} then coalesce(${ticket.unitPriceCents}, 0) + ${ticket.contributionCents} else 0 end), 0)`,
			freeTickets: sql<number>`coalesce(sum(case when ${free} then 1 else 0 end), 0)`
		})
		.from(ticket)
		.where(and(eq(ticket.eventId, eventId), inArray(ticket.status, ['valid', 'checked_in'])));
	return {
		card: { tickets: row?.cardTickets ?? 0, grossCents: row?.cardGrossCents ?? 0 },
		free: { tickets: row?.freeTickets ?? 0 }
	};
}
