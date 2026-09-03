/**
 * Two published, ticketed CMC shows for the ticket-purchase pricing e2e: one
 * whose sliding scale runs to free, and one with a floor under it.
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
import { inArray } from 'drizzle-orm';
import { withPlatformDb } from './platform-db';
import { event } from '../../src/lib/server/db/schema/event';
import { ticket } from '../../src/lib/server/db/schema/ticket';
import { SEED_STAFF_ID } from './seed-staff-user';

export const SEED_TP_EVENT_ID = 'e2e-tp-ticketed';
/**
 * A second show with a floor under its scale.
 *
 * The two events are the two halves of the sliding scale and neither proves the
 * other: on `SEED_TP_EVENT_ID` a buyer can go all the way to $0 and the submit
 * button becomes "Get ticket", and on this one $0 is refused because the act
 * asked for a minimum. A single fixture would only ever exercise one of them.
 */
export const SEED_TP_FLOOR_EVENT_ID = 'e2e-tp-floored';
// Deliberately contains none of the words the spec asserts on ("Contribution",
// "Total", "discount") — a title that collides with them turns every text
// assertion into a strict-mode violation.
export const SEED_TP_EVENT_TITLE = 'E2E Pay What You Can Show';

/** $20.00 — round, and halves cleanly, so a member price reads as $10.00. */
export const SEED_TP_PRICE_CENTS = 2000;

/** $10.00 — the floor under `SEED_TP_FLOOR_EVENT_ID`, well clear of the dead zone. */
export const SEED_TP_FLOOR_CENTS = 1000;

function daysFromNow(days: number, hour = 20): Date {
	const d = new Date();
	d.setDate(d.getDate() + days);
	d.setHours(hour, 0, 0, 0);
	return d;
}

export async function seedTicketPurchase(): Promise<void> {
	await withPlatformDb(async (db) => {
		const ids = [SEED_TP_EVENT_ID, SEED_TP_FLOOR_EVENT_ID];
		await db.delete(ticket).where(inArray(ticket.eventId, ids));
		await db.delete(event).where(inArray(event.id, ids));

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
			// The scale runs all the way to free: this is the NOTAFLOF show.
			ticketPriceFloorCents: 0,
			ticketQuantity: 50,
			createdByUserId: SEED_STAFF_ID
		});

		await db.insert(event).values({
			id: SEED_TP_FLOOR_EVENT_ID,
			title: 'E2E Show With A Floor',
			description: 'Seeded for the ticket sliding-scale e2e.',
			startsAt,
			endsAt,
			status: 'published',
			publishedAt: new Date(),
			source: 'cmc',
			ticketingEnabled: true,
			ticketPrice: SEED_TP_PRICE_CENTS,
			ticketPriceFloorCents: SEED_TP_FLOOR_CENTS,
			ticketQuantity: 50,
			createdByUserId: SEED_STAFF_ID
		});
	});
}
