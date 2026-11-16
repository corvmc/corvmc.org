/**
 * A published $20 CMC show whose sliding scale runs to free, for the
 * ticket-purchase checkout e2e. Its own row, because the suite's other ticketed
 * rows belong to specs that assert on them (`SEED_CE_TICKETED_ID` proves a sold
 * ticket blocks deletion).
 *
 * Idempotent: deletes its tickets and recreates its rows on every run, so the
 * tickets the checkout cases buy do not accumulate.
 */
import { inArray } from 'drizzle-orm';
import { withPlatformDb } from './platform-db';
import { eventListing } from '../../src/lib/server/db/schema/event';
import { ticket, ticketSale } from '../../src/lib/server/db/schema/ticket';
import { SEED_STAFF_ID } from './seed-staff-user';

export const SEED_TP_EVENT_ID = 'e2e-tp-ticketed';
export const SEED_TP_EVENT_TITLE = 'E2E Pay What You Can Show';

/** $20.00 — round, and halves cleanly, so a member price reads as $10.00. */
export const SEED_TP_PRICE_CENTS = 2000;

function daysFromNow(days: number, hour = 20): Date {
	const d = new Date();
	d.setDate(d.getDate() + days);
	d.setHours(hour, 0, 0, 0);
	return d;
}

export async function seedTicketPurchase(): Promise<void> {
	await withPlatformDb(async (db) => {
		const ids = [SEED_TP_EVENT_ID];
		await db.delete(ticket).where(inArray(ticket.eventId, ids));
		await db.delete(eventListing).where(inArray(eventListing.id, ids));

		const startsAt = daysFromNow(21);
		const endsAt = new Date(startsAt.getTime() + 3 * 60 * 60 * 1000);

		await db.insert(eventListing).values({
			id: SEED_TP_EVENT_ID,
			title: SEED_TP_EVENT_TITLE,
			description: 'Seeded for the ticket contribution e2e.',
			startsAt,
			endsAt,
			status: 'published',
			publishedAt: new Date(),
			source: 'cmc',
			createdByUserId: SEED_STAFF_ID
		});

		await db.insert(ticketSale).values({
			eventListingId: SEED_TP_EVENT_ID,
			enabled: true,
			priceCents: SEED_TP_PRICE_CENTS,
			// The scale runs all the way to free: this is the NOTAFLOF show.
			priceFloorCents: 0,
			quantity: 50
		});
	});
}
