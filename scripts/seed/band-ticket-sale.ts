import { and, asc, eq, gt } from 'drizzle-orm';
import { bandStripeAccount } from '../../src/lib/server/db/schema/audio';
import { bandSite } from '../../src/lib/server/db/schema/band-site';
import { eventListing } from '../../src/lib/server/db/schema/event';
import { group } from '../../src/lib/server/db/schema/group';
import { ticket, ticketSale } from '../../src/lib/server/db/schema/ticket';
import { db } from './db';

/**
 * A premium band selling its own gig through the collective (#1203).
 *
 * Reads back a band that is premium and whose Connect account takes charges —
 * the only kind `sellerFor` lets sell — and puts its next published gig on
 * sale, with two paid purchases so the band's card shows what has sold.
 * Runs after `seedAudio`, which writes the Connect accounts.
 */
export async function seedBandTicketSale(): Promise<{ bandName: string; eventId: string } | null> {
	console.log('Seeding a band ticket sale...');

	const [row] = await db
		.select({ id: group.id, name: group.name, gigId: eventListing.id })
		.from(group)
		.innerJoin(bandStripeAccount, eq(bandStripeAccount.groupId, group.id))
		.innerJoin(bandSite, eq(bandSite.groupId, group.id))
		.innerJoin(eventListing, eq(eventListing.groupId, group.id))
		.where(
			and(
				eq(bandStripeAccount.chargesEnabled, true),
				eq(bandSite.tier, 'premium'),
				eq(eventListing.source, 'band'),
				eq(eventListing.status, 'published'),
				gt(eventListing.startsAt, new Date())
			)
		)
		.orderBy(asc(eventListing.startsAt), asc(eventListing.id))
		.limit(1);
	if (!row) return null;
	const seller = { id: row.id, name: row.name };
	const gig = { id: row.gigId };

	await db
		.insert(ticketSale)
		.values({
			eventListingId: gig.id,
			groupId: seller.id,
			enabled: true,
			priceCents: 1200,
			priceFloorCents: 500,
			quantity: 120
		})
		.onConflictDoUpdate({
			target: ticketSale.eventListingId,
			set: {
				groupId: seller.id,
				enabled: true,
				priceCents: 1200,
				priceFloorCents: 500,
				quantity: 120
			}
		});

	// The band's share was transferred at the sale, so it is not on these rows:
	// `actsCents` is what went to the band, and the collective's share is its own.
	const purchases = [
		{
			purchaseId: 'seed-band-sale-1',
			quantity: 2,
			unitPriceCents: 1200,
			actsCents: 2080,
			collectiveCents: 200
		},
		{
			purchaseId: 'seed-band-sale-2',
			quantity: 1,
			unitPriceCents: 800,
			actsCents: 747,
			collectiveCents: 0
		}
	];
	for (const p of purchases) {
		for (let i = 0; i < p.quantity; i++) {
			await db.insert(ticket).values({
				eventId: gig.id,
				purchaseId: p.purchaseId,
				attendeeName: `Seed buyer ${p.purchaseId.slice(-1)}`,
				attendeeEmail: `seed.buyer${p.purchaseId.slice(-1)}@example.com`,
				code: `SEED-BAND-${p.purchaseId.slice(-1)}-${i + 1}`,
				status: 'valid',
				stripePaymentRecordId: `pi_seed_${p.purchaseId}`,
				unitPriceCents: p.unitPriceCents,
				// Order-level, on the first ticket only, as checkout writes them.
				actsCents: i === 0 ? p.actsCents : 0,
				collectiveCents: i === 0 ? p.collectiveCents : 0
			});
		}
	}

	return { bandName: seller.name, eventId: gig.id };
}
