import { and, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { ticket, ticketSale } from '$lib/server/db/schema/ticket';
import { bandSite } from '$lib/server/db/schema/band-site';
import { destinationFor } from '$lib/server/audio/connect-service';
import { stripe } from '$lib/server/stripe';
import { BAND_TICKET_PLATFORM_FEE_BPS, TICKET_COLLECTIVE_SHARE_BPS } from '$lib/config';

/**
 * Who a listing's tickets are sold for, and so where the money goes (#1203).
 *
 * The collective sells its own shows into its own account. A band sells its
 * own gig into its own Connect account by destination charge (#1471), and only
 * while it is premium and Stripe will take charges for it.
 */
export type TicketSeller =
	| { kind: 'collective'; shareBps: number }
	| { kind: 'band'; groupId: string; destinationAccountId: string; shareBps: number };

export interface SellerListing {
	id: string;
	source: string;
	groupId: string | null;
	ticketingEnabled: boolean;
}

/** The sale's seller column; null for the collective, or for no sale row. */
async function saleGroupId(eventListingId: string): Promise<string | null> {
	const [row] = await db
		.select({ groupId: ticketSale.groupId })
		.from(ticketSale)
		.where(eq(ticketSale.eventListingId, eventListingId))
		.limit(1);
	return row?.groupId ?? null;
}

/** Null when nobody may sell this listing's tickets through us right now. */
export async function sellerFor(listing: SellerListing): Promise<TicketSeller | null> {
	if (!listing.ticketingEnabled) return null;

	const groupId = await saleGroupId(listing.id);
	if (!groupId) {
		// The collective never sells a show it is not putting on.
		return listing.source === 'cmc'
			? { kind: 'collective', shareBps: TICKET_COLLECTIVE_SHARE_BPS }
			: null;
	}

	if (listing.source !== 'band' || listing.groupId !== groupId) return null;
	if (await bandSaleBlocker(groupId)) return null;
	const destinationAccountId = await destinationFor(groupId);
	if (!destinationAccountId) return null;
	return { kind: 'band', groupId, destinationAccountId, shareBps: BAND_TICKET_PLATFORM_FEE_BPS };
}

/** Why a band may not sell through us right now, or null when it may. */
export async function bandSaleBlocker(
	groupId: string
): Promise<'not_premium' | 'no_payouts' | null> {
	const [site] = await db
		.select({ tier: bandSite.tier })
		.from(bandSite)
		.where(eq(bandSite.groupId, groupId))
		.limit(1);
	if (site?.tier !== 'premium') return 'not_premium';
	if (!(await destinationFor(groupId))) return 'no_payouts';
	return null;
}

const HELD = ['valid', 'checked_in'] as const;

/**
 * Give every buyer of a band's gig their money back (#1472).
 *
 * Each paid purchase is refunded once, reversing the band's transfer and the
 * collective's fee so neither party funds the other's share. The idempotency
 * key makes a retried cancel safe. A collective sale is left alone: refunding
 * a CMC show is a staff decision, made in Stripe.
 */
export async function refundBandTicketSale(eventListingId: string): Promise<{ refunded: number }> {
	if (!(await saleGroupId(eventListingId))) return { refunded: 0 };

	const rows = await db
		.select({ purchaseId: ticket.purchaseId, paymentRef: ticket.stripePaymentRecordId })
		.from(ticket)
		.where(and(eq(ticket.eventId, eventListingId), inArray(ticket.status, [...HELD])));

	const purchases = new Map<string, string | null>();
	for (const row of rows) purchases.set(row.purchaseId, row.paymentRef);

	let refunded = 0;
	for (const [purchaseId, paymentRef] of purchases) {
		// A free claim never reached Stripe; cancelling it is the whole refund.
		if (paymentRef?.startsWith('pi_')) {
			await stripe.refunds.create(
				{ payment_intent: paymentRef, reverse_transfer: true, refund_application_fee: true },
				{ idempotencyKey: `band-ticket-refund-${purchaseId}` }
			);
			refunded++;
		}
		await db
			.update(ticket)
			.set({ status: 'cancelled', updatedAt: new Date() })
			.where(and(eq(ticket.purchaseId, purchaseId), inArray(ticket.status, [...HELD])));
	}
	return { refunded };
}
