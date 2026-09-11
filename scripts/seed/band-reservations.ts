import { reservation } from '../../src/lib/server/db/schema/reservation';
import { claimRoomNear } from './room';
import { db } from './db';
import { pick, ptDate, randomInt } from './util';

/**
 * `alsoInclude` is appended to the slice rather than folded into `bands`,
 * because a persona band appended to that array falls outside every
 * `slice(0, n)` in the seed and a persona band spliced into it moves whichever
 * band it displaced. Named here, its rows are drawn last and nothing else moves.
 */
export async function seedBandReservations(bands: any[], alsoInclude: any[] = []) {
	console.log('Seeding band reservations...');
	const rows = [];

	const chosen = [...bands.filter((x: any) => !x.deletedAt).slice(0, 4), ...alsoInclude];
	for (const b of chosen) {
		for (const day of [-6, 3]) {
			const hour = randomInt(17, 20);
			const duration = pick([2, 3]);
			const slot = claimRoomNear(ptDate(day, hour), duration);
			if (!slot) continue;
			const { startsAt, endsAt } = slot;
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
