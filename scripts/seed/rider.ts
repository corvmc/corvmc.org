import { rider, riderElement, riderInput } from '../../src/lib/server/db/schema/rider';
import { group, groupMember } from '../../src/lib/server/db/schema/group';
import { bandSite } from '../../src/lib/server/db/schema/band-site';
import { media, mediaAttachment } from '../../src/lib/server/db/schema/media';
import { eventListing, eventBand } from '../../src/lib/server/db/schema/event';
import { directoryEntry } from '../../src/lib/server/db/schema/directory';
import { user, account } from '../../src/lib/server/db/schema/authentication';
import { modelHasRole } from '../../src/lib/server/db/schema/authorization';
import { batchInsert, db } from './db';
import { scryptHash } from './hash';
import { type SeedRole } from './types';
import { randomUUID } from 'crypto';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import type { RiderElementKind as RiderElementKindValue } from '../../src/lib/config';

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
		.where(
			and(
				eq(group.kind, 'band'),
				eq(bandSite.tier, 'free'),
				isNull(group.deletedAt),
				// **Bands the admin account is not in.** `seedBands` hands ownership
				// out of `allUsers`, which includes the admin — and on a band they
				// belong to, the staff *pseudo-role* never applies: they get the
				// member view. The staff read-only state would then be structurally
				// unreachable, and a screenshot of it would be a member view wearing
				// the wrong caption.
				sql`not exists (
					select 1 from group_member gm2
					  join user u2 on u2.id = gm2.user_id
					 where gm2.group_id = ${group.id} and u2.email = 'admin@corvallismusic.org'
				)`
			)
		)
		.groupBy(group.id)
		.orderBy(desc(sql`active_members`), asc(group.slug));

	if (bands.length < 4) return { riders: 0, uploaded: 0 };

	/**
	 * Four bands, because a rider has four states worth looking at and each one
	 * is a different answer to "has this act told us anything".
	 *
	 * Taken from the top of the roster-size ordering rather than the far end:
	 * the smallest free band is the solo act, which is somebody else's fixture
	 * and a roster of one — a poor stand-in for any of these.
	 */
	const structured = bands[0]; // filled in, comfortably inside the room
	const oversized = bands[1]; // filled in, more channels than the desk has
	const uploadOnly = bands[2]; // a PDF and nothing else
	const empty = bands[3]; // nothing at all — the state every band starts in

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
		// On all four, so every state is reachable from one login rather than
		// needing a different account per band — and so the *member* view of the
		// upload-only and empty bands exists at all, which staff-only access
		// would not show.
		for (const band of [structured, oversized, uploadOnly, empty]) {
			await db.insert(groupMember).values({
				groupId: band.id,
				userId: persona.id,
				role: persona.role,
				position: persona.position,
				status: 'active',
				createdAt
			});
		}
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

	// Where each corner stands, as percent of the stage. A real arrangement
	// rather than a grid — drums upstage centre, bass and guitar flanking,
	// vocals downstage, keys off to one side — so the plot renders as something
	// an engineer would recognise rather than as test data.
	//
	// Computed past the fifth rather than cycling the list: `seedBands` hands out
	// rosters of one to four plus the two personas, so a modulo would drop the
	// sixth player exactly on top of the first and the seeded plot would ship
	// with two items nobody could tell apart.
	const NAMED_SPOTS = [
		{ x: 50, y: 20 },
		{ x: 25, y: 45 },
		{ x: 75, y: 45 },
		{ x: 50, y: 75 },
		{ x: 12, y: 62 }
	];
	const spotFor = (i: number) =>
		NAMED_SPOTS[i] ?? { x: 12 + ((i - NAMED_SPOTS.length) % 5) * 19, y: 88 };

	/**
	 * Five corners, however many people are on the roster.
	 *
	 * `seedBands` hands out one to four members and the two personas join on top,
	 * so an uncapped loop makes the band's channel count swing between resets —
	 * and a headline number that moves is one nobody can check by eye or write a
	 * caption about. Capping also leaves the later members with an **empty**
	 * corner, which is a state worth having: most bands have somebody who has not
	 * filled theirs in yet.
	 */
	roster.slice(0, 5).forEach((member, i) => {
		const corner = CORNERS[i % CORNERS.length];
		const spot = spotFor(i);
		const elementId = randomUUID();
		elementRows.push({
			id: elementId,
			riderId: head.id,
			userId: member.userId,
			kind: corner.kind,
			label: corner.label,
			providedBy: 'band',
			sortOrder: 0,
			x: spot.x,
			y: spot.y
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
			sortOrder: 1,
			// Just downstage of whoever it points at.
			x: spot.x,
			y: Math.min(95, spot.y + 12)
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
		sortOrder: 0,
		// Left unplaced on purpose: the plot's tray of "not on the stage yet" is a
		// state with its own affordance, and a seed where everything is already
		// placed never shows it.
		x: null,
		y: null
	});
	inputRows.push(
		{ elementId: playbackId, label: 'Playback L', source: 'di', phantom: true, sortOrder: 0 },
		{ elementId: playbackId, label: 'Playback R', source: 'di', phantom: true, sortOrder: 1 }
	);

	await batchInsert(riderElement, elementRows, 8);
	await batchInsert(riderInput, inputRows, 8);

	// ----------------------------------------------------------------- oversized

	/**
	 * A band that asks for more than the room has.
	 *
	 * The over-capacity notice is the only surface in the feature that cannot be
	 * reached by filling things in normally — the default desk is 16 channels and
	 * a seeded five-piece lands at twelve — so without this the warning renders
	 * nowhere in dev and the copy nobody can see is the copy nobody maintains.
	 *
	 * A fully-miked kit and three vocals, which is a real ask rather than a
	 * padded one: this is exactly the rider a house engineer sub-mixes.
	 */
	const [bigHead] = await db
		.insert(rider)
		.values({
			groupId: oversized.groupId ?? oversized.id,
			monitorFormat: 'iems',
			notes: 'We can drop the tom mics and the third vocal if the desk is tight.'
		})
		.returning();

	const BIG: { kind: RiderElementKindValue; label: string; inputs: string[] }[] = [
		{
			kind: 'drum_kit',
			label: 'Kit (fully miked)',
			inputs: [
				'Kick in',
				'Kick out',
				'Snare top',
				'Snare bottom',
				'Hi-hat',
				'Rack tom',
				'Floor tom',
				'OH L',
				'OH R'
			]
		},
		{ kind: 'bass_rig', label: 'Bass rig', inputs: ['Bass DI', 'Bass cab'] },
		{ kind: 'guitar_amp', label: 'Guitar SR', inputs: ['Gtr 1'] },
		{ kind: 'guitar_amp', label: 'Guitar SL', inputs: ['Gtr 2'] },
		{ kind: 'keys', label: 'Nord', inputs: ['Keys L', 'Keys R'] },
		{ kind: 'vocals', label: 'Lead vocal', inputs: ['Lead vox'] },
		{ kind: 'vocals', label: 'Vocal SR', inputs: ['BV 1'] },
		{ kind: 'vocals', label: 'Vocal SL', inputs: ['BV 2'] },
		{ kind: 'playback', label: 'Tracks', inputs: ['Tracks L', 'Tracks R'] }
	];

	const bigElements: (typeof riderElement.$inferInsert)[] = [];
	const bigInputs: (typeof riderInput.$inferInsert)[] = [];

	BIG.forEach((entry, i) => {
		const id = randomUUID();
		bigElements.push({
			id,
			riderId: bigHead.id,
			// Unowned: this band's rider was filled in by whoever books them, which
			// is a real way it happens and the state where every row is admin-only.
			userId: null,
			kind: entry.kind,
			label: entry.label,
			providedBy: 'band',
			sortOrder: i
		});
		entry.inputs.forEach((label, j) => {
			bigInputs.push({ elementId: id, label, source: 'mic', sortOrder: j });
		});
	});

	await batchInsert(riderElement, bigElements, 8);
	await batchInsert(riderInput, bigInputs, 8);

	// ------------------------------------------------------- put them on a bill

	/**
	 * Credit the two riders-with-data on CMC's busiest own show.
	 *
	 * Without this the advance surface's Tech riders card renders only "not in
	 * yet" and "not a CMC act" rows: `seedCmcEventLineups` bills premium bands
	 * and external acts, none of which has a rider, so the card's whole point —
	 * a channel count, a phantom count, what the band needs from us — is
	 * unreachable in dev. A card that only ever shows its empty branch is one
	 * nobody notices is wrong.
	 */
	const [bill] = await db
		.select({ id: eventListing.id })
		.from(eventListing)
		.innerJoin(eventBand, eq(eventBand.eventId, eventListing.id))
		.where(eq(eventListing.source, 'cmc'))
		.groupBy(eventListing.id)
		.orderBy(desc(sql`count(${eventBand.id})`))
		.limit(1);

	if (bill) {
		const [{ maxOrder }] = await db
			.select({ maxOrder: sql<number>`coalesce(max(${eventBand.billingOrder}), -1)`.as('m') })
			.from(eventBand)
			.where(eq(eventBand.eventId, bill.id));

		// Which acts are already credited, by name. `seedCmcEventLineups` bills some
		// of these by bare name, and adding a second credit for the same act is a
		// duplicate on the bill rather than a fixture — the UI survives it now, but
		// the seed should not be inventing one.
		const already = new Set(
			(
				await db
					.select({ name: eventBand.name })
					.from(eventBand)
					.where(eq(eventBand.eventId, bill.id))
			).map((r) => r.name.toLowerCase())
		);

		let order = Number(maxOrder) + 1;
		for (const band of [structured, oversized]) {
			if (already.has(band.name.toLowerCase())) continue;
			const [entry] = await db
				.select({ id: directoryEntry.id })
				.from(directoryEntry)
				.where(eq(directoryEntry.groupId, band.id))
				.limit(1);
			if (!entry) continue;
			await db.insert(eventBand).values({
				eventId: bill.id,
				name: band.name,
				directoryEntryId: entry.id,
				billingOrder: order++,
				status: 'confirmed'
			});
		}
	}

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

	return {
		riders: 2,
		uploaded: 1,
		structuredBand: structured.name,
		oversizedBand: oversized.name,
		uploadBand: uploadOnly.name,
		emptyBand: empty.name
	};
}
