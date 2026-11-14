import type Stripe from 'stripe';
import { and, eq, gte, inArray, isNull, lte, sql, type SQL } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { eventListing } from '#lib/server/db/schema/event.js';
import { ticket, ticketSale } from '#lib/server/db/schema/ticket.js';
import { donation } from '#lib/server/db/schema/donation.js';
import { stripe } from '#lib/server/stripe.js';
import { DomainError } from '#lib/server/domain-error.js';
import { captureException } from '#lib/server/sentry.js';
import { openUnmatchedPaymentTask } from '#lib/server/finance/unmatched-payment-task.js';
import { doorTicketSplit } from '#lib/finance/ticket-split.js';
import { recordDoorTicketSale, recordFreeTicketSale } from '#lib/server/finance/ticket-entries.js';
import { recordAuditEntry } from '#lib/server/audit/audit-service.js';
import {
	DOOR_PURCHASE_PREFIX,
	doorPaymentOf,
	doorPayments,
	newDoorPurchaseId,
	type DoorTakings
} from '#lib/door/takings.js';
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
	| { kind: 'cash'; purchaseId: string; quantity: number; chargeCents: number }
	| {
			kind: 'card';
			eventId: string;
			paymentIntentId: string;
			clientSecret: string;
			chargeCents: number;
	  };

/**
 * Price a door sale and let them in free, take cash (#2800), or open a
 * card-present intent. Free and cash are checked in on the spot.
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
	payment?: 'card' | 'cash';
	now?: Date;
}): Promise<DoorSaleStart> {
	const { eventId, quantity, unitPriceCents, staffUserId, payment, now = new Date() } = input;
	const row = (await doorEvents(now)).find((e) => e.id === eventId);
	if (!row) throw new DoorSaleError('That show is not on sale at the door');
	const event = await toDoorEvent(row);

	if (unitPriceCents < event.floorCents) {
		throw new DoorSaleError(`Each ticket is at least $${(event.floorCents / 100).toFixed(2)}`);
	}

	const split = doorTicketSplit({
		unitPriceCents,
		quantity,
		suggestedUnitCents: event.suggestedCents,
		payment
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
		const purchaseId = newDoorPurchaseId('free');
		await createTickets({
			...tickets,
			purchaseId,
			status: 'checked_in',
			checkedInByUserId: staffUserId
		});
		await recordFreeTicketSale({ purchaseId, eventId, quantity, occurredAt: now });
		return { kind: 'free', purchaseId, quantity };
	}

	if (payment === 'cash') {
		const purchaseId = newDoorPurchaseId('cash');
		await createTickets({
			...tickets,
			purchaseId,
			status: 'checked_in',
			checkedInByUserId: staffUserId
		});
		await recordDoorTicketSale({
			purchaseId,
			eventId,
			chargeCents: split.chargeCents,
			actsCents: split.actsCents,
			feeCents: 0,
			occurredAt: now,
			payment: 'cash'
		});
		await recordAuditEntry({
			action: 'event.door_cash_sale',
			subject: { type: 'event', id: eventId, label: event.title },
			details: { purchaseId, quantity, amountCents: split.chargeCents }
		});
		return { kind: 'cash', purchaseId, quantity, chargeCents: split.chargeCents };
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

/** Twice the 24 hours `cancelStalePendingTickets` waits, so a missed tap is seen before and after. */
const SWEEP_WINDOW_MS = 48 * 3600_000;

export interface DoorSaleSweep {
	/** Succeeded door intents looked at. */
	checked: number;
	/** Intents whose `pending` rows the sweep checked in. */
	fulfilled: string[];
	/** Intents with no live rows to check in, left for a staffer to attach or refund. */
	unmatched: string[];
}

/**
 * The backstop for a `payment_intent.succeeded` that never arrived (#2547).
 * It runs `fulfillDoorSale`, the webhook's own writer, so a re-run or a late
 * webhook writes nothing twice. An intent whose rows are gone or cancelled is
 * reported, not written: the card was charged and a staffer decides.
 */
export async function sweepDoorSales(now = new Date()): Promise<DoorSaleSweep> {
	const result: DoorSaleSweep = { checked: 0, fulfilled: [], unmatched: [] };
	const createdGte = Math.floor((now.getTime() - SWEEP_WINDOW_MS) / 1000);
	let startingAfter: string | undefined;
	for (;;) {
		const page = await stripe.paymentIntents.list({
			created: { gte: createdGte },
			limit: 100,
			...(startingAfter ? { starting_after: startingAfter } : {})
		});
		for (const intent of page.data) {
			if (intent.status !== 'succeeded' || intent.metadata?.type !== 'door_ticket') continue;
			result.checked++;
			const rows = await getTicketsByPurchase(intent.id);
			if (rows.some((r) => r.status === 'pending')) {
				await fulfillDoorSale(intent);
				result.fulfilled.push(intent.id);
			} else if (!rows.some((r) => r.status === 'checked_in')) {
				result.unmatched.push(intent.id);
				captureException(new Error('Door card payment has no tickets'), {
					event: 'door-sale.unmatched',
					paymentIntentId: intent.id,
					eventId: intent.metadata.event_id,
					amountCents: intent.amount
				});
				await openUnmatchedPaymentTask({
					paymentIntentId: intent.id,
					kind: 'sale',
					amountCents: intent.amount,
					eventId: intent.metadata.event_id
				});
			}
		}
		if (!page.has_more || page.data.length === 0) break;
		startingAfter = page.data.at(-1)?.id;
	}
	return result;
}

/**
 * The show a door sale was for, which decides who may act on it: null when the
 * id is not a door purchase. Online purchase ids are bare UUIDs, never `pi_`.
 */
export async function doorSaleEventId(purchaseId: string): Promise<string | null> {
	if (doorPaymentOf(purchaseId) !== 'card') return null;
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

export type { DoorTakings } from '#lib/door/takings.js';

/** A ticket row's door method, as SQL, from the same prefixes `doorPaymentOf` reads. */
function soldBy(payment: keyof typeof DOOR_PURCHASE_PREFIX) {
	const prefix = DOOR_PURCHASE_PREFIX[payment];
	return sql`substr(${ticket.purchaseId}, 1, ${prefix.length}) = ${prefix}`;
}

/**
 * Summed from the door's own ticket rows, one line per method in
 * `doorPayments`. Live rows only, so an untapped or cancelled sale counts
 * nothing. As sold: a refund is made in Stripe, which this cannot see.
 */
export async function getEventDoorTakings(eventId: string): Promise<DoorTakings> {
	const gross = sql`coalesce(${ticket.unitPriceCents}, 0) + ${ticket.contributionCents}`;
	const lines = Object.fromEntries(
		doorPayments.flatMap((p) => [
			[`${p}Tickets`, sql<number>`coalesce(sum(case when ${soldBy(p)} then 1 else 0 end), 0)`],
			[`${p}Gross`, sql<number>`coalesce(sum(case when ${soldBy(p)} then ${gross} else 0 end), 0)`]
		])
	) as Record<string, SQL<number>>;
	const [[row], [gifts]] = await Promise.all([
		db
			.select({
				...lines,
				checkedIn: sql<number>`coalesce(sum(case when ${ticket.status} = 'checked_in' then 1 else 0 end), 0)`
			})
			.from(ticket)
			.where(and(eq(ticket.eventId, eventId), inArray(ticket.status, ['valid', 'checked_in']))),
		db
			.select({
				count: sql<number>`count(*)`,
				grossCents: sql<number>`coalesce(sum(${donation.amountCents}), 0)`
			})
			.from(donation)
			.where(and(eq(donation.eventId, eventId), eq(donation.status, 'paid')))
	]);
	const line = (p: (typeof doorPayments)[number]) => ({
		tickets: Number(row?.[`${p}Tickets`] ?? 0),
		grossCents: Number(row?.[`${p}Gross`] ?? 0)
	});
	return {
		card: line('card'),
		cash: line('cash'),
		free: line('free'),
		donations: { count: gifts?.count ?? 0, grossCents: gifts?.grossCents ?? 0 },
		checkedIn: row?.checkedIn ?? 0
	};
}
