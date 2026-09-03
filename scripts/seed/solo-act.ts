import { user, account } from '../../src/lib/server/db/schema/authentication';
import { modelHasRole } from '../../src/lib/server/db/schema/authorization';
import { reservation } from '../../src/lib/server/db/schema/reservation';
import { insertBandWithOwner } from './bands';
import { db } from './db';
import { scryptHash } from './hash';
import { pendingEntries, pendingTags } from './pending';
import { type SeedRole } from './types';
import { ptDate, randomInt } from './util';

/**
 * A one-person act, with a working login.
 *
 * A solo performer is a `group` like any other — `kind` stays `'band'`, the
 * roster is one `group_member` row, and promotion to a multi-person act is a
 * second insert with nothing to migrate. See `docs/specs/groups-spec.md`
 * § Solo acts, which this seeds the reachable case for.
 *
 * It exists because the copy on every act surface is now written to be true at
 * a roster of one ("Nobody else yet", "Invite anyone else in this act",
 * "Book the practice space and it'll show up here for the whole act"), and none
 * of that could be read on a real page while the seed only ever produced bands
 * of three to four.
 *
 * Deliberately kept out of `allUsers`, for the same reason the volunteer and
 * sustaining personas are: `seedUserRoles` indexes into that array and
 * `seedVolunteerProfiles` slices it, so appending would silently reassign both.
 * The member number comes from the free 80–89 block — 80–83 are the sustaining
 * personas, 90–93 the volunteer ones, 100–119 the bulk members.
 */
const PERSONA = {
	id: 'seed-solo-act-owner',
	email: 'soloact@corvallismusic.org',
	name: 'Wren Halloway',
	memberNumber: 84
};

const ACT = {
	name: 'Wren Halloway',
	slug: 'wren-halloway',
	bio: 'One voice, one guitar, and a loop pedal that does the rest. Plays anywhere with a corner and an outlet.'
};

// Lower-case to match the `GENRES` and `INSTRUMENTS` pools: the directory's
// chips are the distinct tag values, so 'Folk' would sit beside 'folk' as a
// second chip.
const GENRES = ['folk', 'indie'];
const INSTRUMENTS = ['guitar', 'vocals'];

export async function seedSoloAct(roles: SeedRole[]) {
	console.log('Seeding solo act...');
	const memberRole = roles.find((r) => r.name === 'member')?.id;
	if (!memberRole) return null;

	const createdAt = new Date(Date.now() - 240 * 86400000);

	await db.insert(user).values({
		id: PERSONA.id,
		name: PERSONA.name,
		email: PERSONA.email,
		emailVerified: true,
		pronouns: 'they/them',
		memberNumber: PERSONA.memberNumber,
		creditFreeHours: 4,
		createdAt,
		updatedAt: createdAt
	});
	await db.insert(account).values({
		id: `${PERSONA.id}-credential`,
		accountId: PERSONA.id,
		providerId: 'credential',
		userId: PERSONA.id,
		password: await scryptHash('password'),
		createdAt,
		updatedAt: createdAt
	});
	await db.insert(modelHasRole).values({ roleId: memberRole, userId: PERSONA.id });

	// The performer's own member listing stays alongside the act's: one is the
	// person in the member directory, the other is the act on a bill. Both are
	// public so the pair can be read against each other locally.
	pendingEntries.set(PERSONA.id, {
		bio: 'Songwriter. Plays solo, sits in with anyone who asks.',
		tagline: 'Songwriter, solo performer',
		hometown: 'Corvallis, OR',
		visibility: 'public',
		contact: { email: PERSONA.email },
		openToCollaboration: true
	});
	for (const value of INSTRUMENTS) {
		pendingTags.push({ subjectId: PERSONA.id, kind: 'instrument', value });
	}

	// No second `group_member` row: the roster is the owner and nobody else,
	// which is the whole point of the fixture.
	const act = await insertBandWithOwner(
		{ name: ACT.name, slug: ACT.slug, bio: ACT.bio, createdAt, updatedAt: createdAt },
		PERSONA.id,
		'Guitar & vocals'
	);

	pendingEntries.set(act.id, {
		tagline: 'Solo folk from Corvallis',
		hometown: 'Corvallis, OR',
		foundedYear: '2021',
		visibility: 'public',
		contact: { email: `booking+${ACT.slug}@example.com` },
		links: [
			{
				label: 'Bandcamp',
				url: 'https://bandcamp.com/',
				embed: false
			}
		]
	});
	for (const value of GENRES) {
		pendingTags.push({ subjectId: act.id, kind: 'genre', value });
	}

	// One upcoming booking, so the act's Reservations page is not empty — the
	// band-reservation seeder only reaches the first four bands, and this one is
	// appended after them.
	const hour = randomInt(17, 20);
	await db.insert(reservation).values({
		bookerType: 'group',
		bookerId: act.id,
		createdByUserId: PERSONA.id,
		status: 'confirmed',
		startsAt: ptDate(4, hour),
		endsAt: ptDate(4, hour + 2),
		notes: 'Working up the new set'
	});

	return act;
}

/** Where to sign in to read the solo-act surfaces. */
export const SOLO_ACT_LOGIN = { email: PERSONA.email, slug: ACT.slug };
