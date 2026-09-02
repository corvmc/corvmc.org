import { reservation } from '../../src/lib/server/db/schema/reservation';
import { db } from './db';
import { pick, ptDate, randomInt } from './util';

export async function seedBandReservations(bands: any[]) {
	console.log('Seeding band reservations...');
	const rows = [];

	for (const b of bands.filter((x: any) => !x.deletedAt).slice(0, 4)) {
		for (const day of [-6, 3]) {
			const hour = randomInt(17, 20);
			const duration = pick([2, 3]);
			const startsAt = ptDate(day, hour);
			const endsAt = ptDate(day, hour + duration);
			const isPast = day < 0;

			const [r] = await db
				.insert(reservation)
				.values({
					bookerType: 'group',
					bookerId: b.id,
					// A band booking is still made by a person, and their free hours
					// settle it — same shape the band-facing booking form produces.
					createdByUserId: b.ownerId,
					status: isPast ? 'completed' : 'confirmed',
					startsAt,
					endsAt,
					notes: pick(['Full band rehearsal', 'Set list run-through', 'Pre-show practice']),
					paidAt: isPast ? startsAt : null
				})
				.returning();
			rows.push(r);
		}
	}

	return rows;
}
