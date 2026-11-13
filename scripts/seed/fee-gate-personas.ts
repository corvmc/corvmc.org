import { user, account } from '../../src/lib/server/db/schema/authentication';
import { modelHasRole } from '../../src/lib/server/db/schema/authorization';
import { reservation } from '../../src/lib/server/db/schema/reservation';
import { formatDateInTz } from '../../src/lib/server/reservation/timezone';
import { DEFAULT_TIMEZONE } from '../../src/lib/config';
import { db, env } from './db';
import { scryptHash } from './hash';
import { ptDate } from './util';
import { type SeedRole } from './types';

/**
 * The outstanding-fee limit (#2748), switched on with both states reachable.
 * `fees-one@` owes one session since the cutoff and books with a warning;
 * `fees-two@` owes two and is refused. Each also owes one session from before
 * the cutoff, which never counts. Password `password`; member numbers 77–78.
 */
export async function seedFeeGatePersonas(roles: SeedRole[]) {
	console.log('Seeding outstanding-fee personas...');
	const memberRole = roles.find((r) => r.name === 'member')?.id;
	if (!memberRole) return { users: 0, cutoff: null };

	// Production sets this on Practice space settings the day it goes live.
	const cutoff = formatDateInTz(ptDate(-14, 12), DEFAULT_TIMEZONE);
	await env.KV.put('site-config:reservation.feeGateFrom', JSON.stringify(cutoff));

	const joined = ptDate(-200, 12);
	const personas = [
		{
			id: 'seed-fees-one',
			name: 'Juno Pratt',
			email: 'fees-one@corvallismusic.org',
			n: 77,
			owed: [-3]
		},
		{
			id: 'seed-fees-two',
			name: 'Otis Varga',
			email: 'fees-two@corvallismusic.org',
			n: 78,
			owed: [-4, -9]
		}
	];
	for (const p of personas) {
		await db.insert(user).values({
			id: p.id,
			name: p.name,
			email: p.email,
			emailVerified: true,
			memberNumber: p.n,
			createdAt: joined,
			updatedAt: joined
		});
		await db.insert(account).values({
			id: `${p.id}-credential`,
			accountId: p.id,
			providerId: 'credential',
			userId: p.id,
			password: await scryptHash('password'),
			createdAt: joined,
			updatedAt: joined
		});
		await db.insert(modelHasRole).values({ roleId: memberRole, userId: p.id });
		// Before the cutoff: payment due on the staff list, never counted.
		for (const day of [...p.owed, -30]) {
			await db.insert(reservation).values({
				bookerType: 'user',
				bookerId: p.id,
				createdByUserId: p.id,
				status: 'confirmed',
				startsAt: ptDate(day, 10),
				endsAt: ptDate(day, 12),
				cashDueCents: 3000,
				createdAt: ptDate(day - 2, 12)
			});
		}
	}
	return { users: personas.length, cutoff };
}
