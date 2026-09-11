import { recurringSeries } from '../../src/lib/server/db/schema/recurring';
import { holdRoom, isRoomFree } from './room';
import { reservation } from '../../src/lib/server/db/schema/reservation';
import { buildSeedRRule as seedRRule } from '../seed-rrule';
import { db } from './db';
import { type SeedUser } from './types';
import { pick, ptDate } from './util';
import { sql } from 'drizzle-orm';

export async function seedRecurringSeries(users: SeedUser[]) {
	console.log('Seeding recurring series...');
	const rows = [];
	const frequencies = ['weekly', 'biweekly', 'monthly'] as const;

	for (let i = 0; i < 4; i++) {
		const member = users[i % users.length];
		const freq = frequencies[i % frequencies.length];
		const dayOffset = i;
		const hour = 10 + i * 2;
		const duration = pick([1, 1.5, 2]);

		// A series repeats on the same clock, so the prototype's slot has to be
		// free on every week it lands on — not just its own.
		const weeks = [0, 7, 14];
		const wanted = weeks.map((d) => ptDate(dayOffset - 14 + d, hour));
		if (!wanted.every((w) => isRoomFree(w, new Date(w.getTime() + duration * 3_600_000)))) continue;
		const slots = wanted.map(
			(w) => holdRoom(w, new Date(w.getTime() + duration * 3_600_000), 'recurring').startsAt
		);

		const protoStart = slots[0];
		const protoEnd = new Date(protoStart.getTime() + duration * 3_600_000);

		const [proto] = await db
			.insert(reservation)
			.values({
				bookerType: 'user',
				bookerId: member.id,
				createdByUserId: member.id,
				status: 'completed',
				startsAt: protoStart,
				endsAt: protoEnd,
				notes: `Recurring ${freq} practice`
			})
			.returning();

		const rrule = seedRRule(protoStart, freq);

		const [series] = await db
			.insert(recurringSeries)
			.values({
				prototypeType: 'reservation',
				prototypeId: proto.id,
				rrule,
				createdBy: member.id
			})
			.returning();
		rows.push(series);

		await db.run(
			sql`UPDATE reservation SET recurring_series_id = ${series.id} WHERE id = ${proto.id}`
		);

		for (let w = 1; w <= 2; w++) {
			const instStart = slots[w];
			const instEnd = new Date(instStart.getTime() + duration * 3_600_000);
			const status = instStart < new Date() ? 'completed' : 'scheduled';

			await db.insert(reservation).values({
				bookerType: 'user',
				bookerId: member.id,
				createdByUserId: member.id,
				status,
				startsAt: instStart,
				endsAt: instEnd,
				notes: `Recurring ${freq} practice`,
				recurringSeriesId: series.id
			});
		}
	}

	{
		const member = users[5];
		const protoStart = ptDate(-21, 14);
		const protoEnd = ptDate(-21, 16);

		const [proto] = await db
			.insert(reservation)
			.values({
				bookerType: 'user',
				bookerId: member.id,
				createdByUserId: member.id,
				status: 'completed',
				startsAt: protoStart,
				endsAt: protoEnd,
				notes: 'Cancelled recurring session'
			})
			.returning();

		const rrule = seedRRule(protoStart, 'weekly');

		const [series] = await db
			.insert(recurringSeries)
			.values({
				prototypeType: 'reservation',
				prototypeId: proto.id,
				rrule,
				createdBy: member.id,
				cancelledAt: new Date(Date.now() - 7 * 86400000)
			})
			.returning();
		rows.push(series);

		await db.run(
			sql`UPDATE reservation SET recurring_series_id = ${series.id} WHERE id = ${proto.id}`
		);
	}

	return rows;
}
