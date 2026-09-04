import {
	account,
	type DirectoryVisibility,
	user
} from '../../src/lib/server/db/schema/authentication';
import { modelHasRole, role } from '../../src/lib/server/db/schema/authorization';
import { db } from './db';
import { scryptHash } from './hash';
import { pendingEntries, pendingTags } from './pending';
import {
	FIRST_NAMES,
	GENRES,
	HOMETOWNS,
	INSTRUMENTS,
	LAST_NAMES,
	MEMBER_BIOS,
	PRONOUNS,
	SAMPLE_LINKS,
	TAGLINES
} from './pools';
import { type SeedRole, type SeedUser } from './types';
import { pick, pickN, randomInt } from './util';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';

export async function seedRoles(): SeedRole[] {
	console.log('Seeding roles...');
	// The named positions are seeded alongside the legacy rows so local dev has
	// somebody to sign in as for each one. Without them the matrix is only ever
	// exercised by `staff`, which holds nearly everything, and a narrowed
	// position is something you can only read about. See positionLabels in
	// src/lib/config.ts.
	const roles = [
		'admin',
		'staff',
		'technology_coordinator',
		'volunteer_coordinator',
		'site_moderator',
		'treasurer',
		'member',
		'volunteer',
		'sustaining'
	];
	const inserted: SeedRole[] = [];
	for (const name of roles) {
		const [r] = await db.insert(role).values({ name, guardName: 'web' }).returning();
		inserted.push(r);
	}
	return inserted;
}

export async function seedUsers(count: number): SeedUser[] {
	console.log(`Seeding ${count} users...`);
	const users: SeedUser[] = [];
	const usedEmails = new Set<string>();

	for (let i = 0; i < count; i++) {
		const first = pick(FIRST_NAMES);
		const last = pick(LAST_NAMES);
		const name = `${first} ${last}`;
		let email = `${first.toLowerCase()}.${last.toLowerCase()}@example.com`;

		let suffix = 1;
		while (usedEmails.has(email)) {
			email = `${first.toLowerCase()}.${last.toLowerCase()}${suffix}@example.com`;
			suffix++;
		}
		usedEmails.add(email);

		const id = randomUUID();
		const createdAt = new Date(Date.now() - randomInt(7, 365) * 86400000);

		const hasProfile = Math.random() > 0.3;
		const memberInstruments = hasProfile ? pickN(INSTRUMENTS, randomInt(1, 3)) : [];
		const memberGenres = hasProfile ? pickN(GENRES, randomInt(1, 3)) : [];
		const memberLinks =
			hasProfile && Math.random() > 0.4 ? pickN(SAMPLE_LINKS, randomInt(1, 3)) : null;
		const visibility = !hasProfile ? 'hidden' : Math.random() > 0.6 ? 'public' : 'members';

		const [u] = await db
			.insert(user)
			.values({
				id,
				name,
				email,
				emailVerified: true,
				pronouns: pick(PRONOUNS),
				phone: Math.random() > 0.4 ? `541-555-${String(randomInt(1000, 9999))}` : null,
				creditFreeHours: randomInt(0, 8),
				creditEquipment: randomInt(0, 3),
				memberNumber: 100 + i,
				createdAt,
				updatedAt: createdAt
			})
			.returning();

		// The listing half. Written to `directory_entry` by `seedDirectoryEntries`
		// once every subject exists — these columns are gone from `user`.
		pendingEntries.set(id, {
			bio: hasProfile ? pick(MEMBER_BIOS) : null,
			tagline: hasProfile ? pick(TAGLINES) : null,
			hometown: hasProfile ? pick(HOMETOWNS) : null,
			lookingFor: hasProfile && Math.random() > 0.7 ? 'band' : null,
			availableForHire: hasProfile && Math.random() > 0.7,
			teachesLessons: hasProfile && Math.random() > 0.8,
			openToCollaboration: hasProfile && Math.random() > 0.5,
			visibility: visibility as DirectoryVisibility,
			contact: visibility === 'public' ? { email } : null,
			links: memberLinks
		});

		for (const value of memberInstruments) {
			pendingTags.push({ subjectId: id, kind: 'instrument', value });
		}
		for (const value of memberGenres) {
			pendingTags.push({ subjectId: id, kind: 'genre', value });
		}

		users.push({ ...u, email });
	}
	return users;
}

export async function seedAdminUser(): Promise<SeedUser> {
	console.log('Seeding admin user (admin@corvallismusic.org)...');
	const id = randomUUID();
	const now = new Date();
	const hashedPassword = await scryptHash('password');

	const [adminUser] = await db
		.insert(user)
		.values({
			id,
			name: 'Admin',
			email: 'admin@corvallismusic.org',
			emailVerified: true,
			// #0001. The account every local session signs in as, so it is also the
			// account that has to show a working `/m/{n}` address on /member/profile
			// — a dev whose own profile has no address card would think the feature
			// was broken. Nothing else claims a number this low.
			memberNumber: 1,
			createdAt: now,
			updatedAt: now
		})
		.returning();

	await db.insert(account).values({
		id: randomUUID(),
		accountId: id,
		providerId: 'credential',
		userId: id,
		password: hashedPassword,
		createdAt: now,
		updatedAt: now
	});

	return { ...adminUser, email: 'admin@corvallismusic.org' };
}

export async function seedUserRoles(users: SeedUser[], adminUser: SeedUser, roles: SeedRole[]) {
	console.log('Assigning roles...');
	const adminRole = roles.find((r) => r.name === 'admin')!;
	const staffRole = roles.find((r) => r.name === 'staff')!;
	const memberRole = roles.find((r) => r.name === 'member')!;
	const volunteerRole = roles.find((r) => r.name === 'volunteer')!;
	const sustainingRole = roles.find((r) => r.name === 'sustaining')!;

	await db.insert(modelHasRole).values([
		{ roleId: adminRole.id, userId: adminUser.id },
		{ roleId: staffRole.id, userId: adminUser.id },
		{ roleId: memberRole.id, userId: adminUser.id }
	]);

	for (let i = 0; i < 2; i++) {
		await db.insert(modelHasRole).values([
			{ roleId: adminRole.id, userId: users[i].id },
			{ roleId: staffRole.id, userId: users[i].id }
		]);
	}

	for (let i = 2; i < 5; i++) {
		await db.insert(modelHasRole).values({ roleId: staffRole.id, userId: users[i].id });
	}

	// One persona per named position, so every row of the matrix can be signed
	// in as. This is the only way anyone reviews the narrowing against a real
	// screen rather than against a table: a treasurer should reach /staff/payments
	// and not /staff/settings, a volunteer coordinator should reach the hour
	// queue and not the role picker on a user.
	const positionSeeds: Array<[string, number]> = [
		['technology_coordinator', 5],
		['volunteer_coordinator', 6],
		['site_moderator', 7],
		['treasurer', 8]
	];
	for (const [name, index] of positionSeeds) {
		const positionRole = roles.find((r) => r.name === name);
		if (!positionRole || !users[index]) continue;
		await db
			.insert(modelHasRole)
			.values({ roleId: positionRole.id, userId: users[index].id })
			.onConflictDoNothing();
		console.log(`  ${name}: ${users[index].email}`);
	}

	for (const u of users) {
		await db.insert(modelHasRole).values({ roleId: memberRole.id, userId: u.id });
	}

	for (const u of pickN(users, 6)) {
		await db
			.insert(modelHasRole)
			.values({ roleId: volunteerRole.id, userId: u.id })
			.onConflictDoNothing();
	}

	for (const u of pickN(users, 8)) {
		await db
			.insert(modelHasRole)
			.values({ roleId: sustainingRole.id, userId: u.id })
			.onConflictDoNothing();

		// Give sustaining members an active subscription snapshot so the membership
		// page renders the dashboard view. hoursPerReset and creditFreeHours are in
		// credits (30-min blocks): each $5-unit grants one hour = two credits.
		const units = pick([2, 5, 12]); // $10 / $25 / $60 per month
		const hoursPerReset = units * 2;
		const startedAt = new Date(Date.now() - randomInt(30, 365) * 86400000);
		const creditsResetAt = new Date(Date.now() + randomInt(3, 27) * 86400000);
		await db
			.update(user)
			.set({
				stripeId: `cus_seed_${u.id.slice(0, 8)}`,
				creditFreeHours: randomInt(0, hoursPerReset),
				subscription: {
					startedAt: startedAt.toISOString(),
					stripeSubscriptionId: `sub_seed_${randomUUID().slice(0, 8)}`,
					hoursPerReset,
					creditsResetAt: creditsResetAt.toISOString(),
					coveringFees: Math.random() > 0.6,
					cancelAtPeriodEnd: false
				}
			})
			.where(eq(user.id, u.id));
	}
}
