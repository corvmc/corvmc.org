import { TICKET_CONTRIBUTION_PRESETS } from '../../src/lib/config';
import { user } from '../../src/lib/server/db/schema/authentication';
import { event } from '../../src/lib/server/db/schema/event';
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
		.select({ id: event.id, startsAt: event.startsAt, ticketPrice: event.ticketPrice })
		.from(event)
		.where(eq(event.ticketingEnabled, true));

	// Who actually gets the half-price rate. Pricing every seeded buyer as a
	// member would make the staff ledger look like the discount is automatic for
	// everyone, which is the one thing it is not.
	const sustainingIds = new Set(
		(await db.select({ id: user.id, subscription: user.subscription }).from(user))
			.filter((u) => u.subscription != null)
			.map((u) => u.id)
	);
	const sustainingBuyers = users.filter((u) => sustainingIds.has(u.id));

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

			// Deterministic rather than sampled, and cast by purchase index so every
			// paid show carries all four money states a staffer might see:
			//   p=0  a member who took the discount and chipped in anyway
			//   p=1  a member who declined the discount to support the show
			//   p≥2  whoever, usually a non-member at full price
			// Rolling dice for these left the ledger empty often enough that the
			// feature looked unused locally.
			const wantsMember = !isFree && p < 2 && sustainingBuyers.length > 0;
			const buyer = wantsMember ? pick(sustainingBuyers) : pick(users);
			const email = `${buyer.name.toLowerCase().replace(' ', '.')}@example.com`;

			const isMember = sustainingIds.has(buyer.id);
			const contributionCents = !isFree && p === 0 ? pick([...TICKET_CONTRIBUTION_PRESETS]) : 0;
			const discountWaived = wantsMember && p === 1;
			// Free shows cost nothing. Otherwise the member rate applies unless the
			// buyer isn't a member, or is one and declined it.
			const unitPriceCents = isFree
				? 0
				: isMember && !discountWaived
					? Math.round(evt.ticketPrice! / 2)
					: evt.ticketPrice!;

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
						unitPriceCents,
						// Order-level, so it rides on the purchase's first ticket only.
						contributionCents: i === 0 ? contributionCents : 0,
						discountWaived,
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
