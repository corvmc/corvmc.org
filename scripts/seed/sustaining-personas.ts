import { user, account } from '../../src/lib/server/db/schema/authentication';
import { modelHasRole } from '../../src/lib/server/db/schema/authorization';
import { creditTransaction } from '../../src/lib/server/db/schema/finance';
import { db } from './db';
import { scryptHash } from './hash';
import { type SeedRole } from './types';

/**
 * Named sustaining members, with working logins.
 *
 * The bulk seed already grants `sustaining` to eight random members and writes
 * each one a subscription snapshot — but **none of them has an `account` row**,
 * so nobody could sign in as a sustaining member and `/member/membership` was
 * only ever seen in its logged-out or never-subscribed state. Every branch the
 * page draws for somebody who actually pays was unreachable.
 *
 * These four cover the states that page renders, one persona each, because
 * they are mutually exclusive on a single account:
 *
 * | login          | state                                     |
 * | -------------- | ----------------------------------------- |
 * | `sustaining@`  | active, mid-cycle, part of the hours used |
 * | `cancelling@`  | `cancelAtPeriodEnd` — the "ends on X" view |
 * | `feecoverer@`  | `coveringFees` — the fee-schedule display  |
 * | `lapsed@`      | subscription gone, `stripeId` kept         |
 *
 * Deliberately **not** part of `allUsers`, for the same reason the volunteer
 * personas are not (see `volunteer-personas.ts`): `seedUserRoles` indexes into
 * that array and `seedVolunteerProfiles` slices it, so appending would silently
 * reassign both. Member numbers come from the free 80–89 block — 90–93 are the
 * volunteer personas, 100–119 the bulk members, 999 the first-timer.
 *
 * They keep a placeholder `cus_seed_…` `stripeId`, which is *not* a detail to
 * tidy away. It used to be the case that took the whole page down — a real
 * Stripe call for a customer that does not exist, inside the page query's own
 * `Promise.all`. That call is gone, and the prefix now earns its keep the other
 * way round: `fake-gateway.ts` materialises a card and six months of invoices
 * for a `cus_seed_…` customer, so the billing surfaces that replaced the Stripe
 * portal have something to render for these personas.
 */
const SUSTAINING_PERSONAS = [
	{
		id: 'seed-sus-active',
		email: 'sustaining@corvallismusic.org',
		name: 'Imani Reyes',
		memberNumber: 80,
		/** $25/mo. 10 credits = 5 hours a month; 3 credits spent so far. */
		units: 5,
		usedCredits: 3,
		coveringFees: false,
		cancelAtPeriodEnd: false,
		startedDaysAgo: 214
	},
	{
		id: 'seed-sus-cancelling',
		email: 'cancelling@corvallismusic.org',
		name: 'Theo Brandt',
		memberNumber: 81,
		/** $10/mo, winding down — the hours are still theirs until the period ends. */
		units: 2,
		usedCredits: 1,
		coveringFees: false,
		cancelAtPeriodEnd: true,
		startedDaysAgo: 96
	},
	{
		id: 'seed-sus-feecoverer',
		email: 'feecoverer@corvallismusic.org',
		name: 'Nadia Ellison',
		memberNumber: 82,
		/** $60/mo and covering the processing fee on top. The generous case. */
		units: 12,
		usedCredits: 9,
		coveringFees: true,
		cancelAtPeriodEnd: false,
		startedDaysAgo: 431
	}
] as const;

/**
 * The fourth is shaped differently enough to sit outside the table: no
 * subscription, no `sustaining` role, no allocation — but a `stripeId` and a
 * spent balance, because they used to pay. This is the win-back view, and it is
 * NOT the same as a brand-new member: the page has to tell "never subscribed"
 * from "subscribed once" and only one of those had data before.
 */
const LAPSED = {
	id: 'seed-sus-lapsed',
	email: 'lapsed@corvallismusic.org',
	name: 'Rowan Petrakis',
	memberNumber: 83,
	endedDaysAgo: 51
};

export async function seedSustainingPersonas(roles: SeedRole[]) {
	console.log('Seeding sustaining personas...');
	const roleByName = new Map(roles.map((r) => [r.name, r.id]));
	const memberRole = roleByName.get('member');
	const sustainingRole = roleByName.get('sustaining');
	if (!memberRole || !sustainingRole) return { users: 0 };

	const day = 86_400_000;
	const now = Date.now();
	const ago = (days: number) => new Date(now - days * day);
	const ahead = (days: number) => new Date(now + days * day);

	/** Shared by all four: the user row, its credential, and the member role. */
	const insertPersona = async (p: {
		id: string;
		email: string;
		name: string;
		memberNumber: number;
		createdDaysAgo: number;
		stripeId: string;
		creditFreeHours: number;
		subscription: Record<string, unknown> | null;
	}) => {
		await db.insert(user).values({
			id: p.id,
			name: p.name,
			email: p.email,
			emailVerified: true,
			memberNumber: p.memberNumber,
			stripeId: p.stripeId,
			creditFreeHours: p.creditFreeHours,
			subscription: p.subscription,
			createdAt: ago(p.createdDaysAgo),
			updatedAt: ago(1)
		});
		// Hashed per persona rather than once and reused, so every row carries its
		// own salt like a real signup would.
		await db.insert(account).values({
			id: `${p.id}-credential`,
			accountId: p.id,
			providerId: 'credential',
			userId: p.id,
			password: await scryptHash('password'),
			createdAt: ago(p.createdDaysAgo),
			updatedAt: ago(p.createdDaysAgo)
		});
		await db.insert(modelHasRole).values({ roleId: memberRole, userId: p.id });
	};

	for (const p of SUSTAINING_PERSONAS) {
		const allocated = p.units * 2; // one hour per $5 unit, two credits per hour
		const remaining = allocated - p.usedCredits;

		await insertPersona({
			id: p.id,
			email: p.email,
			name: p.name,
			memberNumber: p.memberNumber,
			createdDaysAgo: p.startedDaysAgo,
			stripeId: `cus_seed_${p.id.slice(-8)}`,
			creditFreeHours: remaining,
			subscription: {
				startedAt: ago(p.startedDaysAgo).toISOString(),
				stripeSubscriptionId: `sub_seed_${p.id.slice(-8)}`,
				hoursPerReset: allocated,
				// Mid-cycle on purpose: a reset date in the past reads as stale, and
				// one on the boundary makes "renews in N days" render zero.
				creditsResetAt: ahead(11).toISOString(),
				coveringFees: p.coveringFees,
				cancelAtPeriodEnd: p.cancelAtPeriodEnd
			}
		});
		await db.insert(modelHasRole).values({ roleId: sustainingRole, userId: p.id });

		// `getUsageSinceLastAllocation` sums everything dated AFTER the newest
		// `monthly_allocation` row, so these two timestamps have to straddle —
		// written on the same date they would collapse to zero used.
		await db.insert(creditTransaction).values({
			userId: p.id,
			creditType: 'free_hours',
			amount: allocated,
			balanceAfter: allocated,
			source: 'monthly_allocation',
			description: 'Monthly free hours allocation',
			metadata: {},
			createdAt: ago(19)
		});
		if (p.usedCredits > 0) {
			await db.insert(creditTransaction).values({
				userId: p.id,
				creditType: 'free_hours',
				amount: -p.usedCredits,
				balanceAfter: remaining,
				source: 'reservation',
				description: 'Applied to reservation',
				metadata: {},
				createdAt: ago(6)
			});
		}
	}

	// The lapsed member: no snapshot, no sustaining role, and no allocation this
	// cycle — but the Stripe customer survives a cancellation in real life, so it
	// survives here too.
	await insertPersona({
		id: LAPSED.id,
		email: LAPSED.email,
		name: LAPSED.name,
		memberNumber: LAPSED.memberNumber,
		createdDaysAgo: 620,
		stripeId: `cus_seed_${LAPSED.id.slice(-8)}`,
		creditFreeHours: 0,
		subscription: null
	});

	return { users: SUSTAINING_PERSONAS.length + 1 };
}
