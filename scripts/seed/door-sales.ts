import { eventListing } from '../../src/lib/server/db/schema/event';
import { ticket, ticketSale } from '../../src/lib/server/db/schema/ticket';
import { db } from './db';

/**
 * Tonight's collective show at the door (#612).
 *
 * `/staff/door` lists only a collective show starting within a day, which the
 * dated event seed cannot promise, so this writes one relative to now. Two
 * sales are already in: one tapped, one let in free below the minimum.
 */
export async function seedDoorSales(adminUserId: string): Promise<{ eventId: string }> {
	console.log('Seeding a show at the door...');

	const startsAt = new Date(Date.now() + 3 * 3600_000);
	const [show] = await db
		.insert(eventListing)
		.values({
			title: 'Door Night: Local Showcase',
			startsAt,
			endsAt: new Date(startsAt.getTime() + 3 * 3600_000),
			status: 'published',
			publishedAt: new Date(),
			source: 'cmc',
			kind: 'show',
			createdByUserId: adminUserId
		})
		.returning({ id: eventListing.id });

	await db.insert(ticketSale).values({
		eventListingId: show.id,
		enabled: true,
		priceCents: 1000,
		priceFloorCents: 0,
		quantity: 80
	});

	const checkedInAt = new Date();
	const door = { eventId: show.id, attendeeName: 'Door sale', attendeeEmail: '' };
	await db.insert(ticket).values([
		{
			...door,
			purchaseId: 'pi_seed_door_1',
			code: 'DOORSEED1',
			status: 'checked_in',
			stripePaymentRecordId: 'pi_seed_door_1',
			unitPriceCents: 1000,
			actsCents: 700,
			collectiveCents: 268,
			checkedInAt,
			checkedInByUserId: adminUserId
		},
		{
			...door,
			purchaseId: 'door-seed-free',
			code: 'DOORSEED2',
			status: 'checked_in',
			unitPriceCents: 0,
			checkedInAt,
			checkedInByUserId: adminUserId
		}
	]);

	return { eventId: show.id };
}
