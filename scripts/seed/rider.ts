import { rider, riderElement, riderInput } from '../../src/lib/server/db/schema/rider';
import { group, groupMember } from '../../src/lib/server/db/schema/group';
import { bandSite } from '../../src/lib/server/db/schema/band-site';
import { media, mediaAttachment } from '../../src/lib/server/db/schema/media';
import { user, account } from '../../src/lib/server/db/schema/authentication';
import { modelHasRole } from '../../src/lib/server/db/schema/authorization';
import { batchInsert, db } from './db';
import { scryptHash } from './hash';
import { type SeedRole } from './types';
import { randomUUID } from 'crypto';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';

/**
 * Tech riders.
 *
 * Two bands, because the feature has two states worth reaching locally and
 * they are answers to different questions:
 *
 * - **A band that filled the thing in.** Every active member owns their own
 *   corner, so the "someone else's gear, read-only" branch is reachable without
 *   logging in twice — which is the state the page's whole permission split
 *   exists for and the one you cannot see from a single account.
 * - **A band that would rather upload the PDF it already has.** Free tier, no
 *   structured rows at all, one attachment in the `rider` slot. Without this the
 *   escape hatch only ever renders empty in dev, and a path nobody sees working
 *   is a path that quietly rots.
 *
 * A **free** band on purpose in both cases: uploading used to be reachable only
 * from the premium page editor, and seeding it on a premium band would keep
 * testing the arrangement this replaced.
 *
 * Nothing here is random. Counts on this page are load-bearing — channels,
 * phantom, mixes, what CMC has to supply — and a stat that moves between resets
 * is one nobody can check by eye.
 */

/**
 * Two logins on one band, because the permission split is the feature and it
 * cannot be seen from a single account.
 *
 * The bulk members `seedUsers` makes have **no `account` row at all** — only
 * personas and the admin can actually sign in — so seeding a rider onto a band
 * of them produces a page nobody can exercise: you would see your own corner
 * and have no way to check that somebody else's is read-only, which is the one
 * behaviour worth checking.
 *
 * These two join an existing band rather than founding a new one, which keeps
 * the fixture to four rows and leaves them on a band that already has a
 * directory entry, a site, events and reservations. The band's own members
 * supply a third corner neither persona owns — the read-only case for the
 * member, the editable case for the admin.
 *
 * Member numbers come from the free 85–89 block: 70–72 are the directory
 * matching personas, 80–83 sustaining, 84 the solo act, 90–93 volunteer, and
 * 100–119 the bulk members.
 */
const PERSONAS = [
	{
		id: 'seed-rider-admin',
		email: 'rideradmin@corvallismusic.org',
		name: 'Marlowe Ives',
		memberNumber: 85,
		role: 'admin' as const,
		position: 'Drums'
	},
	{
		id: 'seed-rider-member',
		email: 'ridermember@corvallismusic.org',
		name: 'Rue Castellan',
		memberNumber: 86,
		role: 'member' as const,
		position: 'Bass'
	}
];

/** Where to sign in to read the two sides of the rider page. */
export const RIDER_LOGINS = PERSONAS.map((p) => ({ email: p.email, role: p.role }));

/** One member's corner, by the instrument they turned out to play. */
const CORNERS = [
	{
		label: 'Drum kit',
		kind: 'drum_kit' as const,
		inputs: [
			{ label: 'Kick in', source: 'mic' as const, stand: 'short_boom' as const },
			{ label: 'Snare top', source: 'mic' as const, stand: 'clip' as const },
			{ label: 'Hi-hat', source: 'mic' as const, stand: 'short_boom' as const, phantom: true },
			{ label: 'Overheads', source: 'mic' as const, stand: 'tall_boom' as const, phantom: true }
		]
	},
	{
		label: 'Bass rig',
		kind: 'bass_rig' as const,
		inputs: [
			{ label: 'Bass DI', source: 'di' as const, phantom: true },
			{ label: 'Bass cab', source: 'mic' as const, stand: 'short_boom' as const }
		]
	},
	{
		label: 'Fender Twin',
		kind: 'guitar_amp' as const,
		inputs: [
			{
				label: 'Gtr 1',
				source: 'mic' as const,
				micPref: 'SM57 or similar',
				stand: 'short_boom' as const
			}
		]
	},
	{
		label: 'Lead vocal',
		kind: 'vocals' as const,
		inputs: [{ label: 'Lead vox', source: 'mic' as const, stand: 'tall_boom' as const }]
	},
	{
		label: 'Rhodes',
		kind: 'keys' as const,
		inputs: [
			{ label: 'Keys L', source: 'di' as const, phantom: true },
			{ label: 'Keys R', source: 'di' as const, phantom: true }
		]
	}
] as const;

export async function seedRiders(roles: SeedRole[]) {
	console.log('Seeding tech riders...');

	// **Free, live, and biggest roster first.**
	//
	// Free because uploading a rider used to be reachable only from the premium
	// page editor, so seeding either state on a premium band would keep
	// exercising the arrangement this replaced. Live because a deactivated band
	// is unreachable, and seeding a state onto it is seeding it nowhere.
	//
	// Roster size because the whole point of the structured rider is that each
	// member owns their own corner — `seedBands` hands out one to three members
	// with a one-in-seven chance of each being `pending`, so taking the first
	// free band by name lands on a one-person roster often enough that the
	// read-only "somebody else's gear" branch would be unreachable without a
	// second login. Slug breaks the tie: a seed writes a whole table inside one
	// second, so `createdAt` ties and the pair picked would drift between resets.
	const bands = await db
		.select({
			id: group.id,
			name: group.name,
			slug: group.slug,
			activeMembers: sql<number>`count(${groupMember.id})`.as('active_members')
		})
		.from(group)
		.innerJoin(bandSite, eq(bandSite.groupId, group.id))
		.leftJoin(groupMember, and(eq(groupMember.groupId, group.id), eq(groupMember.status, 'active')))
		.where(and(eq(group.kind, 'band'), eq(bandSite.tier, 'free'), isNull(group.deletedAt)))
		.groupBy(group.id)
		.orderBy(desc(sql`active_members`), asc(group.slug));

	if (bands.length < 2) return { riders: 0, uploaded: 0 };

	const structured = bands[0];
	// The runner-up, not the far end: taking the smallest roster lands on the
	// solo act, which is somebody else's fixture and a band of one — a poor
	// stand-in for "a working band that would rather hand over the PDF it
	// already has".
	const uploadOnly = bands[1];

	// ------------------------------------------------------------------ personas

	const memberRoleId = roles.find((r) => r.name === 'member')?.id;
	const createdAt = new Date(Date.now() - 200 * 86400000);

	for (const persona of PERSONAS) {
		await db.insert(user).values({
			id: persona.id,
			name: persona.name,
			email: persona.email,
			emailVerified: true,
			memberNumber: persona.memberNumber,
			createdAt,
			updatedAt: createdAt
		});
		await db.insert(account).values({
			id: `${persona.id}-credential`,
			accountId: persona.id,
			providerId: 'credential',
			userId: persona.id,
			password: await scryptHash('password'),
			createdAt,
			updatedAt: createdAt
		});
		if (memberRoleId) {
			await db.insert(modelHasRole).values({ roleId: memberRoleId, userId: persona.id });
		}
		await db.insert(groupMember).values({
			groupId: structured.id,
			userId: persona.id,
			role: persona.role,
			position: persona.position,
			status: 'active',
			createdAt
		});
	}

	// ---------------------------------------------------------------- structured

	const roster = await db
		.select({ userId: groupMember.userId, role: groupMember.role })
		.from(groupMember)
		.where(and(eq(groupMember.groupId, structured.id), eq(groupMember.status, 'active')))
		.orderBy(asc(groupMember.createdAt));

	const [head] = await db
		.insert(rider)
		.values({
			groupId: structured.id,
			techContactUserId: roster.find((m) => m.role === 'owner')?.userId ?? roster[0]?.userId,
			monitorFormat: 'wedges',
			notes:
				'Load-in through the alley door. We need two power drops stage left — the keys rig and the playback laptop are on separate circuits.',
			// Confirmed a fortnight ago, so the page has something other than
			// "never" to render and a staler-than-you-think case exists to look at.
			confirmedAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
			confirmedByUserId: roster[0]?.userId ?? null
		})
		.returning();

	const elementRows: (typeof riderElement.$inferInsert)[] = [];
	const inputRows: (typeof riderInput.$inferInsert)[] = [];

	roster.forEach((member, i) => {
		const corner = CORNERS[i % CORNERS.length];
		const elementId = randomUUID();
		elementRows.push({
			id: elementId,
			riderId: head.id,
			userId: member.userId,
			kind: corner.kind,
			label: corner.label,
			providedBy: 'band',
			sortOrder: 0
		});
		corner.inputs.forEach((input, j) => {
			inputRows.push({
				elementId,
				label: input.label,
				source: input.source,
				micPref: 'micPref' in input ? input.micPref : null,
				phantom: 'phantom' in input ? !!input.phantom : false,
				stand: 'stand' in input ? input.stand : 'none',
				// Everyone hears themselves, which is what makes the mix count mean
				// something on the page.
				monitorMixUserId: member.userId,
				sortOrder: j
			});
		});

		// A wedge each: a monitor is a thing on the stage that belongs to somebody
		// and takes no channel, so it is the case that proves elements and inputs
		// are not the same list.
		elementRows.push({
			id: randomUUID(),
			riderId: head.id,
			userId: member.userId,
			kind: 'monitor',
			label: 'Wedge',
			providedBy: 'venue',
			sortOrder: 1
		});
	});

	// Shared gear: nobody's own corner, so only an admin can touch it — the
	// null-owner branch, which has no other way to exist in dev.
	const playbackId = randomUUID();
	elementRows.push({
		id: playbackId,
		riderId: head.id,
		userId: null,
		kind: 'playback',
		label: 'Playback laptop',
		providedBy: 'band',
		notes: 'Runs the intro tape and two backing tracks.',
		sortOrder: 0
	});
	inputRows.push(
		{ elementId: playbackId, label: 'Playback L', source: 'di', phantom: true, sortOrder: 0 },
		{ elementId: playbackId, label: 'Playback R', source: 'di', phantom: true, sortOrder: 1 }
	);

	await batchInsert(riderElement, elementRows, 8);
	await batchInsert(riderInput, inputRows, 8);

	// ---------------------------------------------------------------- upload only

	// The key names no real object, which is exactly why `backfill-media.ts`
	// refuses to invent one and a seed may — `seedBandSites` takes the same
	// licence for gallery art.
	const [riderFile] = await db
		.insert(media)
		.values({
			key: `bands/${uploadOnly.slug}/media/rider/seed-rider.pdf`,
			contentType: 'application/pdf',
			byteSize: 184_000,
			filename: `${uploadOnly.slug}-rider.pdf`
		})
		.returning();

	await db.insert(mediaAttachment).values({
		mediaId: riderFile.id,
		attachableType: 'group',
		attachableId: uploadOnly.id,
		slot: 'rider',
		sortOrder: 0
	});

	return { riders: 1, uploaded: 1, structuredBand: structured.name, uploadBand: uploadOnly.name };
}
