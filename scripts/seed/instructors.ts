import { directoryEntry, directoryTag } from '../../src/lib/server/db/schema/directory';
import { instructor } from '../../src/lib/server/db/schema/instructor';
import { reservation } from '../../src/lib/server/db/schema/reservation';
import { batchInsert, db } from './db';
import { randomUUID } from 'crypto';
import { eq, inArray } from 'drizzle-orm';

/**
 * Derive `directory_entry` and `directory_tag` from everything already seeded,
 * mirroring `scripts/db/backfill/directory-entry.sql` statement for statement.
 *
 * It reads the tables back rather than being threaded through the dozen places
 * that insert a user or a group, because `pnpm db:reset` replays migrations and
 * then seeds — the backfill script never runs locally or in e2e. It runs as soon
 * as the last of those inserts has happened, which is early enough for a lineup
 * credit to reference an entry and late enough to see every subject.
 * Without this, every directory page goes blank the moment phase 3a's readers
 * land, and it reads as a query bug rather than a fixture gap.
 */
/**
 * A handful of external acts — parties CMC booked that are not members here.
 *
 * Both owner columns null and `visibility: 'hidden'`, which is the whole of what
 * makes one. They exist locally so the staff acts page, and the "links out, not
 * in" render rule on a public bill, have something real behind them.
 */
/**
 * Teachers, across every state the status enum allows.
 *
 * The awkward ones are the point. A staff review queue with nothing in it, an
 * application that has been handed back, a paused grant — those are the screens
 * that otherwise only ever get looked at empty, and the empty case is the one
 * that is already obviously right.
 *
 * Runs after `seedDirectoryEntries` because an instructor without a listing does
 * not appear publicly, which is correct behaviour and useless as fixture data.
 */
export async function seedInstructors(users: any[], reviewer: any) {
	console.log('Seeding instructors...');
	if (users.length < 8) return { rows: 0 };

	const now = new Date();
	const day = 86_400_000;

	// Deterministic slices rather than random picks: a fresh seed should put the
	// same people in the same states every time, so a screenshot means something.
	const [gtr, drums, reachable, paused, applicant, returned] = users.slice(2, 8);

	const entries = await db
		.select({ id: directoryEntry.id, userId: directoryEntry.userId })
		.from(directoryEntry)
		.where(
			inArray(
				directoryEntry.userId,
				[gtr, drums, reachable, paused, applicant, returned].map((u) => u.id)
			)
		);
	const entryFor = new Map(entries.map((e) => [e.userId, e.id]));

	// The two live listings need a *public* entry and a public contact, or the
	// public directory correctly shows nothing — the gate that makes the whole
	// module safe would make the fixture invisible.
	for (const u of [gtr, drums]) {
		await db
			.update(directoryEntry)
			.set({
				visibility: 'public',
				contact: {
					email: `teach.${String(u.name).split(' ')[0].toLowerCase()}@example.com`,
					visibility: 'public'
				}
			})
			.where(eq(directoryEntry.userId, u.id));
	}

	// One **active** instructor deliberately keeps a members-only contact and sets
	// no teaching one. The nudge only renders for an active grant, so putting this
	// on the paused row — as a first pass did — produced a fixture for a screen
	// that could never show it. They stay listed to members and lose only their
	// contact publicly, which is the exact case the exposure test pins.
	await db
		.update(directoryEntry)
		.set({ visibility: 'public', contact: { email: 'private@example.com', visibility: 'members' } })
		.where(eq(directoryEntry.userId, reachable.id));

	// The paused one is publicly contactable — it is paused status, not a missing
	// contact, that keeps them off the listing.
	await db
		.update(directoryEntry)
		.set({ visibility: 'public', contact: { email: 'piano@example.com', visibility: 'public' } })
		.where(eq(directoryEntry.userId, paused.id));

	const rows = [
		{
			id: randomUUID(),
			userId: gtr.id,
			status: 'active' as const,
			headline: 'Guitar — beginner to intermediate',
			blurb: 'Electric and acoustic. Mostly rock, blues and whatever you turn up wanting to play.',
			ratesNote: '$40 per half hour',
			bookingUrl: 'https://example.com/book-a-lesson',
			acceptingStudents: true,
			grantedByUserId: reviewer.id,
			grantedAt: new Date(now.getTime() - 120 * day),
			statusChangedAt: new Date(now.getTime() - 120 * day),
			createdAt: new Date(now.getTime() - 130 * day),
			updatedAt: now
		},
		{
			id: randomUUID(),
			userId: drums.id,
			status: 'active' as const,
			headline: 'Drums and percussion',
			blurb: 'Kit from scratch, or rudiments if you already play. Bring sticks.',
			ratesNote: '$35 / 45 min, or $120 a month',
			// No booking link: the card has to read properly without one.
			acceptingStudents: false,
			grantedByUserId: reviewer.id,
			grantedAt: new Date(now.getTime() - 60 * day),
			statusChangedAt: new Date(now.getTime() - 60 * day),
			createdAt: new Date(now.getTime() - 70 * day),
			updatedAt: now
		},
		{
			// Active and taking students, but reachable only by members — so the
			// public card shows no contact and their own profile shows the nudge.
			id: randomUUID(),
			userId: reachable.id,
			status: 'active' as const,
			headline: 'Voice and songwriting',
			blurb: 'Finding your range, and finishing the song you started two years ago.',
			acceptingStudents: true,
			grantedByUserId: reviewer.id,
			grantedAt: new Date(now.getTime() - 40 * day),
			statusChangedAt: new Date(now.getTime() - 40 * day),
			createdAt: new Date(now.getTime() - 45 * day),
			updatedAt: now
		},
		{
			id: randomUUID(),
			userId: paused.id,
			status: 'paused' as const,
			headline: 'Piano and theory',
			acceptingStudents: true,
			grantedByUserId: reviewer.id,
			grantedAt: new Date(now.getTime() - 300 * day),
			statusChangedAt: new Date(now.getTime() - 20 * day),
			statusNote: 'Off for the summer — back in September.',
			createdAt: new Date(now.getTime() - 310 * day),
			updatedAt: now
		},
		{
			// Waiting on staff. Without one of these the review queue only ever
			// renders its empty state.
			id: randomUUID(),
			userId: applicant.id,
			status: 'requested' as const,
			headline: 'Fiddle and mandolin',
			blurb: 'Old-time and bluegrass, all ages.',
			ratesNote: '$30 an hour, sliding scale',
			applicationNote:
				'Taught at a community school in Eugene for six years. Happy to give references.',
			acceptingStudents: true,
			createdAt: new Date(now.getTime() - 3 * day),
			updatedAt: new Date(now.getTime() - 3 * day)
		},
		{
			// Handed back, waiting on the member — the state the return-state
			// mechanism exists for, and the one nobody would think to click into.
			id: randomUUID(),
			userId: returned.id,
			status: 'rejected' as const,
			headline: 'Lessons',
			applicationNote: 'Been playing 20 years.',
			reviewNotes:
				'Could you say which instruments and roughly what level? "Lessons" on its own is hard for a parent to act on.',
			acceptingStudents: true,
			grantedByUserId: reviewer.id,
			statusChangedAt: new Date(now.getTime() - day),
			createdAt: new Date(now.getTime() - 6 * day),
			updatedAt: new Date(now.getTime() - day)
		}
	];

	await batchInsert(instructor, rows, 5);

	// Instruments come from the directory tags, not from the instructor row —
	// "what I play" and "what I teach" are the same set until someone proves
	// otherwise. Without these the cards render with no instruments at all.
	const tags = [
		[gtr, 'Guitar'],
		[gtr, 'Bass'],
		[drums, 'Drums'],
		[reachable, 'Voice'],
		[paused, 'Piano']
	]
		.map(([u, value]: any) => ({ entryId: entryFor.get(u.id), kind: 'instrument' as const, value }))
		.filter((t) => t.entryId);
	if (tags.length) await batchInsert(directoryTag, tags, 10);

	// Teaching bookings, so the member reservation list and the staff calendar
	// both show a row priced at the teaching rate rather than the drop-in one.
	const teaching = rows[0];
	const lessons = [0, 7, 14].map((offset, i) => ({
		id: randomUUID(),
		bookerType: 'instructor' as const,
		bookerId: teaching.id,
		bookerName: null,
		createdByUserId: gtr.id,
		status: 'confirmed' as const,
		startsAt: new Date(now.getTime() + (offset + 2) * day + 16 * 3_600_000),
		endsAt: new Date(now.getTime() + (offset + 2) * day + 16.5 * 3_600_000),
		notes: i === 0 ? 'Weekly lesson block' : null,
		createdAt: now,
		updatedAt: now
	}));
	await batchInsert(reservation, lessons, 5);

	return { rows: rows.length, lessons: lessons.length };
}
