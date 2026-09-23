import { creditTransaction } from '../../src/lib/server/db/schema/finance';
import { db } from './db';
import { type SeedUser } from './types';
import { random, randomInt } from './util';

export async function seedCreditTransactions(users: SeedUser[]) {
	console.log('Seeding credit transactions...');
	for (const [i, u] of users.slice(0, 12).entries()) {
		const hours = randomInt(2, 8);
		let balance = hours;
		await db.insert(creditTransaction).values({
			userId: u.id,
			creditType: 'free_hours',
			amount: hours,
			balanceAfter: hours,
			source: 'monthly_allocation',
			description: 'Monthly free hours allocation',
			metadata: { period: 'May 2026' }
		});

		if (random() > 0.4) {
			const used = randomInt(1, Math.min(3, hours));
			balance -= used;
			await db.insert(creditTransaction).values({
				userId: u.id,
				creditType: 'free_hours',
				amount: -used,
				balanceAfter: balance,
				source: 'reservation',
				description: 'Applied to reservation',
				metadata: {}
			});
		}

		// One front-desk comp, so the ledger shows a `staff_comp` row (#579).
		if (i === 0) {
			await db.insert(creditTransaction).values({
				userId: u.id,
				creditType: 'free_hours',
				amount: 2,
				balanceAfter: balance + 2,
				source: 'staff_comp',
				description: 'Session cut short by a power outage',
				metadata: {}
			});
		}
	}
}
