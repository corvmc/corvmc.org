import { account, user } from '../../src/lib/server/db/schema/authentication';
import { modelHasRole } from '../../src/lib/server/db/schema/authorization';
import { volunteerProfile, volunteerSignup } from '../../src/lib/server/db/schema/volunteer';
import { db } from './db';
import { scryptHash } from './hash';
import { insertTasksWithShifts } from './shifts';
import { type SeedRole } from './types';

/**
 * `vendorhost@`: the Fall Makers Market's vendor host (#2993), a member with no
 * staff position and no committee seat. A confirmed signup on the market's
 * host shift, in a role whose 30-day lead time is already open three weeks out,
 * so the shift page links the market's vendors and check-in list. Out of
 * `allUsers` for the reason `seedGroupLeaders` gives; member number 77 is free.
 */
export const VENDOR_HOST_PERSONA = {
	id: 'seed-vendor-host',
	email: 'vendorhost@corvallismusic.org',
	name: 'Jonah Ferreira',
	memberNumber: 77
};

export async function seedVendorHost(
	roles: SeedRole[],
	volunteerRoles: Array<{ id: string; name: string }>,
	market: { eventId: string; startsAt: Date; endsAt: Date }
) {
	console.log('Seeding vendor host...');
	const memberRole = roles.find((r) => r.name === 'member')?.id;
	const hostRole = volunteerRoles.find((r) => r.name === 'Vendor host');
	if (!memberRole || !hostRole) return null;

	const p = VENDOR_HOST_PERSONA;
	const createdAt = new Date(Date.now() - 200 * 86400000);
	await db.insert(user).values({
		id: p.id,
		name: p.name,
		email: p.email,
		emailVerified: true,
		memberNumber: p.memberNumber,
		creditFreeHours: 2,
		createdAt,
		updatedAt: createdAt
	});
	await db.insert(account).values({
		id: `${p.id}-credential`,
		accountId: p.id,
		providerId: 'credential',
		userId: p.id,
		password: await scryptHash('password'),
		createdAt,
		updatedAt: createdAt
	});
	await db.insert(modelHasRole).values({ roleId: memberRole, userId: p.id });
	await db.insert(volunteerProfile).values({
		id: `${p.id}-profile`,
		userId: p.id,
		firstName: 'Jonah',
		lastName: 'Ferreira',
		isAdult: true,
		status: 'active',
		availability: 'Saturdays, and a few evenings a month for vendor email.',
		createdAt
	});

	const [task] = await insertTasksWithShifts([
		{
			id: 'seed-vendor-host-task',
			title: 'Host the market vendors',
			volunteerRoleId: hostRole.id,
			eventId: market.eventId,
			startsAt: market.startsAt,
			endsAt: market.endsAt
		}
	]);
	await db.insert(volunteerSignup).values({
		id: `${p.id}-signup`,
		shiftId: task.shiftId,
		userId: p.id,
		status: 'confirmed'
	});
	return { signupId: `${p.id}-signup`, eventId: market.eventId };
}
