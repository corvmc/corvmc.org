import { eventListing } from '../../src/lib/server/db/schema/event';
import { eventRsvp } from '../../src/lib/server/db/schema/event-rsvp';
import { db } from './db';
import { type SeedUser } from './types';
import { pickN, randomInt } from './util';
import { eq } from 'drizzle-orm';

export async function seedRsvps(users: SeedUser[]) {
	console.log('Seeding RSVPs...');
	const rows = [];

	// RSVPs only apply to non-ticketed events (lightweight headcount, no codes).
	const nonTicketedEvents = await db
		.select({ id: eventListing.id })
		.from(eventListing)
		.where(eq(eventListing.ticketingEnabled, false));

	for (const evt of nonTicketedEvents) {
		// A random, distinct subset of members RSVP (unique per event_id, user_id).
		for (const u of pickN(users, randomInt(2, 8))) {
			const [r] = await db
				.insert(eventRsvp)
				.values({
					eventId: evt.id,
					userId: u.id,
					attendeeName: u.name,
					attendeeEmail: `${u.name.toLowerCase().replace(' ', '.')}@example.com`
				})
				.onConflictDoNothing({ target: [eventRsvp.eventId, eventRsvp.userId] })
				.returning();
			if (r) rows.push(r);
		}
	}

	return rows;
}
