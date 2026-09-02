import { creditTransaction } from '../../src/lib/server/db/schema/finance';
import { db } from './db';
import { type SeedUser } from './types';
import { randomInt } from './util';

export async function seedCreditTransactions(users: SeedUser[]) {
	console.log('Seeding credit transactions...');
	for (const u of users.slice(0, 12)) {
		const hours = randomInt(2, 8);
		await db.insert(creditTransaction).values({
			userId: u.id,
			creditType: 'free_hours',
			amount: hours,
			balanceAfter: hours,
			source: 'monthly_allocation',
			description: 'Monthly free hours allocation',
			metadata: { period: 'May 2026' }
		});

		if (Math.random() > 0.4) {
			const used = randomInt(1, Math.min(3, hours));
			await db.insert(creditTransaction).values({
				userId: u.id,
				creditType: 'free_hours',
				amount: -used,
				balanceAfter: hours - used,
				source: 'reservation',
				description: 'Applied to reservation',
				metadata: {}
			});
		}
	}
}
