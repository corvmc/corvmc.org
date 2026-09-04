/**
 * Everything a member has bought, in one list.
 *
 * The member-facing counterpart to the fact that CMC sells several unrelated
 * things through one Stripe account: a record, a ticket, an hour in the practice
 * space. Each has its own table, shaped by what it *is* — a ticket carries a
 * check-in code and a release carries a download token, and collapsing those
 * into one row type would lose the half of each that matters. What they share is
 * only the receipt: who bought it, when, and for how much.
 *
 * So this reads the tables that exist and returns a discriminated union rather
 * than a lowest common denominator. The page switches on `kind` to decide what
 * a row can *do* — download a record, view a ticket — which is exactly the part
 * a generalised row could not have told it.
 *
 * One function, because the page gets one load-bearing query and a component
 * that fans several out is a lint error and, past kit 2.64, a render loop.
 */
import { db } from '$lib/server/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { ticket } from '$lib/server/db/schema/ticket';
import { eventListing } from '$lib/server/db/schema/event';
import { isFeatureEnabled } from '$lib/server/feature-flags';
import { listPurchasesForUser as listReleasePurchases } from '$lib/server/audio/purchase-service';

/** A record bought from a band. */
export type MusicPurchase = {
	kind: 'music';
	id: string;
	purchasedAt: Date | null;
	amountCents: number;
	releaseTitle: string;
	releaseSlug: string;
	bandName: string;
	bandSlug: string;
	downloadToken: string;
};

/** One order of tickets to one event. Several passes, one purchase. */
export type TicketPurchase = {
	kind: 'ticket';
	id: string;
	purchasedAt: Date | null;
	amountCents: number;
	eventTitle: string;
	eventId: string;
	eventStartsAt: Date;
	quantity: number;
};

export type PurchaseRow = MusicPurchase | TicketPurchase;

/** Music rows. Empty when the storefront is switched off, not an error. */
async function musicPurchases(userId: string): Promise<MusicPurchase[]> {
	if (!(await isFeatureEnabled('bandAudio'))) return [];

	// The audio domain owns this query; this maps its columns onto the shared
	// receipt shape rather than re-selecting them, so a change there cannot leave
	// the two reading the same table differently.
	const rows = await listReleasePurchases(userId);

	return rows.map((r) => ({
		kind: 'music' as const,
		id: r.purchaseId,
		purchasedAt: r.paidAt,
		amountCents: r.amountPaidCents,
		releaseTitle: r.releaseTitle,
		releaseSlug: r.releaseSlug,
		bandName: r.bandName,
		bandSlug: r.bandSlug,
		downloadToken: r.downloadToken
	}));
}

/**
 * Ticket rows, grouped into orders.
 *
 * `ticket` has a row per pass and no order table, so a four-ticket purchase
 * would otherwise read as four purchases. `contribution_cents` is the reason
 * this cannot be a plain `SUM` over every column: the buyer's gift is an
 * order-level fact recorded once on the order's first ticket, so summing it
 * per row is already correct and summing the unit prices is too, but only
 * because they mean different things. Grouping by `purchase_id` is what makes
 * both true at once.
 *
 * `cancelled` is excluded — a refunded order is not something you bought.
 */
async function ticketPurchases(userId: string): Promise<TicketPurchase[]> {
	const rows = await db
		.select({
			purchaseId: ticket.purchaseId,
			eventId: eventListing.id,
			eventTitle: eventListing.title,
			eventStartsAt: eventListing.startsAt,
			quantity: sql<number>`COUNT(*)`,
			amountCents: sql<number>`COALESCE(SUM(${ticket.unitPriceCents}), 0) + COALESCE(SUM(${ticket.contributionCents}), 0)`,
			purchasedAt: sql<number>`MIN(${ticket.createdAt})`
		})
		.from(ticket)
		.innerJoin(eventListing, eq(eventListing.id, ticket.eventId))
		.where(
			and(eq(ticket.userId, userId), inArray(ticket.status, ['pending', 'valid', 'checked_in']))
		)
		.groupBy(ticket.purchaseId, eventListing.id, eventListing.title, eventListing.startsAt);

	return rows.map((r) => ({
		kind: 'ticket' as const,
		id: r.purchaseId,
		// Grouped through `MIN`, which hands back the raw epoch rather than the
		// Date drizzle's column mode would have produced.
		purchasedAt: r.purchasedAt ? new Date(Number(r.purchasedAt) * 1000) : null,
		amountCents: Number(r.amountCents),
		eventTitle: r.eventTitle,
		eventId: r.eventId,
		eventStartsAt: r.eventStartsAt,
		quantity: Number(r.quantity)
	}));
}

/**
 * Everything one member has bought, newest first.
 *
 * Sorted in JS rather than SQL because the rows come from two tables that
 * cannot be usefully unioned — their columns barely overlap — and the count is
 * a person's purchase history, not a feed.
 */
export async function listPurchasesForUser(userId: string): Promise<PurchaseRow[]> {
	const [music, tickets] = await Promise.all([musicPurchases(userId), ticketPurchases(userId)]);

	return [...music, ...tickets].sort(
		(a, b) => (b.purchasedAt?.getTime() ?? 0) - (a.purchasedAt?.getTime() ?? 0)
	);
}
