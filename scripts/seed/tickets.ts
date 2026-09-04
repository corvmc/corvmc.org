import { computeTicketSplit, suggestedCollectiveCents } from '../../src/lib/finance/ticket-split';
import { eventListing } from '../../src/lib/server/db/schema/event';
import { ticket } from '../../src/lib/server/db/schema/ticket';
import { db } from './db';
import { TICKET_CODES_PREFIX } from './pools';
import { type SeedEvent, type SeedUser } from './types';
import { pick, randomInt } from './util';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';

export async function seedTickets(users: SeedUser[], _events: SeedEvent[]) {
	console.log('Seeding tickets...');
	const rows = [];

	const ticketedEvents = await db
		.select({
			id: eventListing.id,
			startsAt: eventListing.startsAt,
			ticketPrice: eventListing.ticketPrice,
			floorCents: eventListing.ticketPriceFloorCents
		})
		.from(eventListing)
		.where(eq(eventListing.ticketingEnabled, true));

	for (const evt of ticketedEvents) {
		const ticketCount = randomInt(3, 8);
		const isPast = evt.startsAt < new Date();
		const isFree = !evt.ticketPrice || evt.ticketPrice === 0;

		// Group tickets into 2-3 separate purchases/RSVPs
		const purchaseCount = randomInt(2, 3);
		let remaining = ticketCount;

		for (let p = 0; p < purchaseCount && remaining > 0; p++) {
			const qty = p === purchaseCount - 1 ? remaining : randomInt(1, Math.min(3, remaining));
			remaining -= qty;

			const purchaseId = isFree ? `rsvp-${randomUUID()}` : randomUUID();
			const buyer = pick(users);
			const email = `${buyer.name.toLowerCase().replace(' ', '.')}@example.com`;

			// Deterministic rather than sampled, and cast by purchase index so every
			// paid show carries the money states a staffer might see. Rolling dice
			// for these left the ledger empty often enough that the feature looked
			// unused locally.
			//   p=0  paid above the suggestion, bar left where it opened
			//   p=1  paid the suggestion, bar dragged all the way to the acts
			//   p≥2  paid the floor — as low as the scale goes — and gave the
			//        collective everything divisible, which is the other end
			const suggested = evt.ticketPrice ?? 0;
			const unitPriceCents = isFree
				? 0
				: p === 0
					? suggested + 500
					: p === 1
						? suggested
						: Math.max(evt.floorCents, Math.min(suggested, 200));
			const coverFees = !isFree && p === 0;

			// The bar's three positions, through the same module the buyer's
			// checkout uses — a seed that computed its own arithmetic would put a
			// second implementation in the tree, which is the bug that module exists
			// to prevent.
			const preview = computeTicketSplit({
				unitPriceCents,
				quantity: qty,
				collectiveCents: 0,
				coverFees,
				suggestedUnitCents: suggested
			});
			const divisible = preview.chargeCents - preview.stripeFeeCents;
			const collectiveTarget =
				p === 0 ? suggestedCollectiveCents(divisible) : p === 1 ? 0 : divisible;
			const split = computeTicketSplit({
				unitPriceCents,
				quantity: qty,
				collectiveCents: collectiveTarget,
				coverFees,
				suggestedUnitCents: suggested
			});
			const contributionCents = split.contributionCents;

			for (let i = 0; i < qty; i++) {
				const code = `${TICKET_CODES_PREFIX}-${randomUUID().slice(0, 8).toUpperCase()}`;
				const checkedIn = isPast && Math.random() > 0.3;

				const [t] = await db
					.insert(ticket)
					.values({
						eventId: evt.id,
						purchaseId,
						userId: buyer.id,
						attendeeName: buyer.name,
						attendeeEmail: email,
						code,
						status: checkedIn ? 'checked_in' : 'valid',
						unitPriceCents: split.ticketLineUnitCents,
						// Order-level, so these ride on the purchase's first ticket only.
						contributionCents: i === 0 ? contributionCents : 0,
						actsCents: i === 0 ? split.actsCents : 0,
						collectiveCents: i === 0 ? split.collectiveCents : 0,
						feeCoveredCents: i === 0 ? split.feeCoveredCents : 0,
						checkedInAt: checkedIn ? evt.startsAt : null,
						checkedInByUserId: checkedIn ? users[0].id : null
					})
					.returning();
				rows.push(t);
			}
		}
	}

	return rows;
}
