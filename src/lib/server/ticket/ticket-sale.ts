import { db } from '$lib/server/db';
import { ticketSale } from '$lib/server/db/schema/ticket';

/** The terms a listing is sold on. See `ticketSale` for what each one means. */
export interface TicketSaleTerms {
	enabled: boolean;
	priceCents: number | null;
	priceFloorCents: number;
	quantity: number | null;
	/** The selling band; null is the collective. */
	groupId: string | null;
}

/**
 * Write a listing's sale terms, creating its `ticket_sale` row on first write.
 *
 * Only the terms given are touched on an existing row, so an edit that names
 * the price leaves capacity alone. Returns the unawaited statement, so it can
 * ride in a `db.batch`; null when there is nothing to write. The seller is left
 * as it is unless `groupId` is given.
 */
export function saveTicketSale(eventListingId: string, terms: Partial<TicketSaleTerms>) {
	const set: Partial<TicketSaleTerms> = {};
	for (const key of ['enabled', 'priceCents', 'priceFloorCents', 'quantity', 'groupId'] as const) {
		if (terms[key] !== undefined) Object.assign(set, { [key]: terms[key] });
	}
	if (Object.keys(set).length === 0) return null;

	return db
		.insert(ticketSale)
		.values({ eventListingId, ...set })
		.onConflictDoUpdate({
			target: ticketSale.eventListingId,
			set: { ...set, updatedAt: new Date() }
		});
}
