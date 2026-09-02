import { recurringSeries } from '../../src/lib/server/db/schema/recurring';
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

		const protoStart = ptDate(dayOffset - 14, hour);
		const protoEnd = ptDate(dayOffset - 14, hour + duration);

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
			const instStart = ptDate(dayOffset - 14 + w * 7, hour);
			const instEnd = ptDate(dayOffset - 14 + w * 7, hour + duration);
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
