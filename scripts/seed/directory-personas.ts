import { account, user } from '../../src/lib/server/db/schema/authentication';
import { modelHasRole } from '../../src/lib/server/db/schema/authorization';
import { db } from './db';
import { scryptHash } from './hash';
import { pendingEntries, pendingTags } from './pending';
import { type SeedRole } from './types';
import { randomUUID } from 'crypto';

/**
 * Named members with working logins, one per state the dashboard match card
 * draws.
 *
 * The bulk seed randomises `lookingFor` and the tags behind it, so which of the
 * three states an arbitrary account lands in changes every reset — and the
 * empty state, which is half the feature, was reachable only by editing the
 * database by hand. These three are pinned:
 *
 * | login          | state                                                  |
 * | -------------- | ------------------------------------------------------ |
 * | `seeker@`      | `lookingFor: 'band'` — matched against bands that want their instrument |
 * | `bandleader@`  | `lookingFor: 'members'` — the other direction, matched against members |
 * | `undecided@`   | `lookingFor` unset — the empty state, with a full profile otherwise |
 *
 * `undecided@` matters most and is the easiest to get wrong: it has a tagline,
 * a bio, instruments and genres, so it is **complete** by `isProfileComplete`'s
 * deliberately low bar and still unmatchable. That is exactly the case the card
 * has to explain rather than shrug at, and a blank account would not reach it.
 *
 * Rather than inventing tags and hoping something happens to meet them, each
 * persona is **pointed at data the bulk seed already produced**: `pendingTags`
 * is still in memory here, so the seeker copies an instrument a real band is
 * short of and the bandleader copies one a real member plays. Where the random
 * draw produced neither, the fallback edits one bulk subject into that state —
 * so the card is populated on every reset, not most of them.
 *
 * Deliberately **not** part of `allUsers`, for the reason the volunteer and
 * sustaining personas are not: `seedUserRoles` indexes into that array and
 * `seedVolunteerProfiles` slices it. Member numbers come from the free 70–72
 * block — 80–83 are sustaining, 90–93 volunteer, 100–119 the bulk members.
 *
 * Runs **before** `seedDirectoryEntries`, which is what gives these accounts a
 * `directory_entry` at all: it builds entries from every user in the database
 * at the moment it runs, from `pendingEntries`.
 */
export async function seedDirectoryPersonas(roles: SeedRole[]) {
	console.log('Seeding directory matching personas...');
	const memberRole = roles.find((r) => r.name === 'member');
	if (!memberRole) return { users: 0 };

	const hashedPassword = await scryptHash('password');
	const now = new Date();

	const insertPersona = async (p: {
		id: string;
		email: string;
		name: string;
		memberNumber: number;
	}) => {
		await db.insert(user).values({
			id: p.id,
			name: p.name,
			email: p.email,
			emailVerified: true,
			memberNumber: p.memberNumber,
			pronouns: 'they/them',
			createdAt: now,
			updatedAt: now
		});
		await db.insert(account).values({
			id: randomUUID(),
			accountId: p.id,
			providerId: 'credential',
			userId: p.id,
			password: hashedPassword,
			createdAt: now,
			updatedAt: now
		});
		await db.insert(modelHasRole).values({ roleId: memberRole.id, userId: p.id });
	};

	const tagsOf = (subjectId: string, kind: 'genre' | 'instrument' | 'seeking_instrument') =>
		pendingTags.filter((t) => t.subjectId === subjectId && t.kind === kind).map((t) => t.value);

	// --- the seeker: a member who wants a band -------------------------------
	//
	// Its instrument and genre are lifted off a band that is already looking, so
	// the match is guaranteed rather than probable.
	let bandSubject = [...pendingEntries.entries()].find(
		([id, e]) => e.lookingFor === 'members' && tagsOf(id, 'seeking_instrument').length > 0
	)?.[0];
	if (!bandSubject) {
		// The random draw gave no band that is looking. Make one — a fixed card is
		// the point, and a seed that only sometimes populates it is worse than one
		// that nudges the data.
		const [id, entry] = [...pendingEntries.entries()].find(([id]) => tagsOf(id, 'genre').length)!;
		entry.lookingFor = 'members';
		pendingTags.push({ subjectId: id, kind: 'seeking_instrument', value: 'bass' });
		bandSubject = id;
	}

	const SEEKER = {
		id: 'seed-dir-seeker',
		email: 'seeker@corvallismusic.org',
		name: 'Ada Vogel',
		memberNumber: 70
	};
	await insertPersona(SEEKER);
	pendingEntries.set(SEEKER.id, {
		bio: 'Played in three bands in Eugene, new in town and looking for the next one.',
		tagline: 'Rhythm section, available Tuesdays',
		hometown: 'Corvallis, OR',
		lookingFor: 'band',
		openToCollaboration: true,
		visibility: 'members'
	});
	for (const value of tagsOf(bandSubject, 'seeking_instrument')) {
		pendingTags.push({ subjectId: SEEKER.id, kind: 'instrument', value });
	}
	for (const value of tagsOf(bandSubject, 'genre')) {
		pendingTags.push({ subjectId: SEEKER.id, kind: 'genre', value });
	}

	// --- the bandleader: a member assembling a band --------------------------
	//
	// The mirror, and the direction the member profile form could not express
	// until `lookingFor` replaced its boolean.
	let memberSubject = [...pendingEntries.entries()].find(
		([id, e]) => e.lookingFor === 'band' && tagsOf(id, 'instrument').length > 0 && id !== SEEKER.id
	)?.[0];
	if (!memberSubject) {
		const [id, entry] = [...pendingEntries.entries()].find(
			([id]) => id !== SEEKER.id && tagsOf(id, 'instrument').length > 0
		)!;
		entry.lookingFor = 'band';
		memberSubject = id;
	}

	const LEADER = {
		id: 'seed-dir-leader',
		email: 'bandleader@corvallismusic.org',
		name: 'Marisol Trent',
		memberNumber: 71
	};
	await insertPersona(LEADER);
	pendingEntries.set(LEADER.id, {
		bio: 'Writing again after a long break. Two songs, no band.',
		tagline: 'Putting something together',
		hometown: 'Corvallis, OR',
		lookingFor: 'members',
		openToCollaboration: true,
		visibility: 'members'
	});
	for (const value of tagsOf(memberSubject, 'instrument')) {
		pendingTags.push({ subjectId: LEADER.id, kind: 'seeking_instrument', value });
	}
	for (const value of tagsOf(memberSubject, 'genre')) {
		pendingTags.push({ subjectId: LEADER.id, kind: 'genre', value });
	}
	pendingTags.push({ subjectId: LEADER.id, kind: 'instrument', value: 'guitar' });

	// --- the undecided: a finished profile with nothing to match on ----------
	const UNDECIDED = {
		id: 'seed-dir-undecided',
		email: 'undecided@corvallismusic.org',
		name: 'Kit Alvarez',
		memberNumber: 72
	};
	await insertPersona(UNDECIDED);
	pendingEntries.set(UNDECIDED.id, {
		bio: 'Mostly plays at home. Curious what else is going on around town.',
		tagline: 'Bedroom recordings',
		hometown: 'Philomath, OR',
		// The whole point of this persona. Everything else is filled in.
		lookingFor: null,
		visibility: 'members'
	});
	pendingTags.push({ subjectId: UNDECIDED.id, kind: 'instrument', value: 'keys' });
	pendingTags.push({ subjectId: UNDECIDED.id, kind: 'genre', value: 'indie' });

	return { users: 3 };
}
