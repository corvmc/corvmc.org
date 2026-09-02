import { paymentCache as paymentRecord } from '../../src/lib/server/db/schema/finance';
import { db } from './db';
import { type SeedReservation, type SeedUser } from './types';
import { randomInt } from './util';
import { randomUUID } from 'crypto';

export async function seedPaymentRecords(users: SeedUser[], reservations: SeedReservation[]) {
	console.log('Seeding payment records...');
	const rows = [];

	const payableReservations = reservations
		.filter((r) => ['completed', 'confirmed', 'scheduled'].includes(r.status))
		.slice(0, 25);

	for (const r of payableReservations) {
		const hours = Math.round(((r.endsAt.getTime() - r.startsAt.getTime()) / 3600000) * 2) / 2;
		const amountCents = hours * 1500;
		const method = Math.random() > 0.3 ? 'Cash' : 'Credits';

		const [p] = await db
			.insert(paymentRecord)
			.values({
				id: `pr_seed_${randomUUID().slice(0, 8)}`,
				userId: r.createdByUserId,
				reservationId: r.id,
				stripeCustomerId: `cus_seed${randomInt(1000, 9999)}`,
				amountCents,
				paymentMethod: method,
				status: Math.random() > 0.1 ? 'completed' : 'refunded',
				paidAt: r.startsAt,
				refundedAt: Math.random() > 0.9 ? new Date() : null
			})
			.returning();
		rows.push(p);
	}

	return rows;
}
