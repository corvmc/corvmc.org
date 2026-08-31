/**
 * A published, ticketed CMC show for the ticket-purchase pricing e2e.
 *
 * The suite's other ticketed rows belong to specs that assert on them (the
 * community-events fixture's `SEED_CE_TICKETED_ID` exists to prove a sold ticket
 * blocks deletion), so this one is its own: a $20 show whose purchase page can
 * be loaded and priced without touching anyone else's expectations.
 *
 * Read-only for the test — nothing here is bought. The purchase form submits to
 * Stripe, and the e2e's job is the arithmetic the page previews, not the charge.
 *
 * Idempotent: deletes and recreates its own rows on every run.
 */
import { eq, inArray } from 'drizzle-orm';
import { withPlatformDb } from './platform-db';
import { event } from '../../src/lib/server/db/schema/event';
import { ticket } from '../../src/lib/server/db/schema/ticket';
import { SEED_STAFF_ID } from './seed-staff-user';

export const SEED_TP_EVENT_ID = 'e2e-tp-ticketed';
// Deliberately contains none of the words the spec asserts on ("Contribution",
// "Total", "discount") — a title that collides with them turns every text
// assertion into a strict-mode violation.
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
		await db.delete(ticket).where(inArray(ticket.eventId, [SEED_TP_EVENT_ID]));
		await db.delete(event).where(eq(event.id, SEED_TP_EVENT_ID));

		const startsAt = daysFromNow(21);
		const endsAt = new Date(startsAt.getTime() + 3 * 60 * 60 * 1000);

		await db.insert(event).values({
			id: SEED_TP_EVENT_ID,
			title: SEED_TP_EVENT_TITLE,
			description: 'Seeded for the ticket contribution e2e.',
			startsAt,
			endsAt,
			status: 'published',
			publishedAt: new Date(),
			source: 'cmc',
			ticketingEnabled: true,
			ticketPrice: SEED_TP_PRICE_CENTS,
			ticketQuantity: 50,
			createdByUserId: SEED_STAFF_ID
		});
	});
}
