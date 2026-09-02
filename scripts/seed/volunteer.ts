import {
	memberCertification,
	volunteerCertification,
	volunteerHourLog,
	volunteerProfile,
	volunteerRole,
	volunteerRoleCertification,
	volunteerRoleInterest,
	volunteerShift,
	volunteerShiftFeedback,
	volunteerSignup
} from '../../src/lib/server/db/schema/volunteer';
import { batchInsert, db } from './db';
import { type SeedEvent } from './types';
import { pick, pickN, ptDate, randomInt } from './util';
import { randomUUID } from 'crypto';

// `defaultDurationMinutes` / `defaultCapacity` are what the New Shift form starts
// with, so they are only set on the roles that really are scheduled as shifts —
// leaving the committee roles blank exercises the fallback path too.
export const VOLUNTEER_ROLE_SEEDS: Array<{
	name: string;
	description: string;
	group: 'at-shows' | 'away-from-shows' | 'committee';
	displayOrder: number;
	isActive?: boolean;
	defaultDurationMinutes?: number;
	defaultCapacity?: number;
}> = [
	{
		name: 'Sound Engineering',
		group: 'at-shows' as const,
		description:
			'Run the board for a show or open mic. Line check, monitor mixes, and a house mix that respects the room.\n\n**No experience needed** — we will train you on the desk before you fly solo.',
		displayOrder: 10,
		defaultDurationMinutes: 300,
		defaultCapacity: 1
	},
	{
		name: 'Event Setup',
		group: 'at-shows' as const,
		description:
			'Get the room ready before doors: chairs, tables, PA, stage lighting, and the merch table.\n\nUsually a two-hour window starting three hours before the show.',
		displayOrder: 20,
		defaultDurationMinutes: 120,
		defaultCapacity: 3
	},
	{
		name: 'Front Desk',
		group: 'at-shows' as const,
		description:
			'Cover the door during open hours or at a show. Greet people, take entry, answer questions about membership, and point folks at the practice room.',
		displayOrder: 30,
		defaultDurationMinutes: 240,
		defaultCapacity: 2
	},
	{
		name: 'Load-Out & Teardown',
		group: 'at-shows' as const,
		description:
			'After the last set: strike the stage, coil cables, reset the floor, and take the trash out. The fastest way to make yourself indispensable.',
		displayOrder: 40,
		defaultDurationMinutes: 90,
		defaultCapacity: 4
	},
	{
		name: 'Facilities & Maintenance',
		group: 'away-from-shows' as const,
		description:
			'Keep the space working — patch drywall, swap bulbs, restring the loaner guitars, fix the door that sticks.\n\nBring whatever skills you have; there is always something.',
		displayOrder: 50
	},
	{
		name: 'Outreach & Tabling',
		group: 'away-from-shows' as const,
		description:
			'Represent CMC at the farmers market, campus events, and other venues. Hand out info, talk to musicians, sign people up.',
		displayOrder: 60
	},
	{
		name: 'Administration',
		group: 'committee' as const,
		description:
			'Behind-the-scenes work: data entry, grant paperwork, scheduling, and answering the inbox.',
		displayOrder: 70
	},
	{
		// Archived so the restore path and the "archived roles still resolve in
		// reports" behaviour both have coverage on a fresh seed.
		name: 'Zine & Print',
		group: 'committee' as const,
		description: 'Layout and printing for the quarterly zine. On hiatus while we rethink the run.',
		displayOrder: 80,
		isActive: false
	}
];

export const VOLUNTEER_DESCRIPTIONS = [
	'Ran sound for the Thursday open mic',
	'Set up chairs and PA for the all-ages show',
	'Front desk during afternoon open hours',
	'Load-out and floor reset after the show',
	'Restrung and cleaned the loaner guitars',
	'Tabled at the farmers market',
	'Sorted and labelled the cable bin',
	'Covered the door for the benefit gig',
	'Monitor mixes for the four-band bill',
	'Patched and repainted the green room wall',
	'Entered new member signups from the show',
	'Hauled the backline over from storage'
];

export const VOLUNTEER_REJECT_NOTES = [
	'This looks like a duplicate of the log you filed the same day — resubmit just the one.',
	'We had you down for two hours on this, not five. Log the corrected time and we will approve it.',
	'Practice time is not volunteer time, but thanks for pitching in on the reset afterward — log that part.',
	'No record of this shift. Check the date and resubmit.'
];

export async function seedVolunteerRoles() {
	console.log('Seeding volunteer roles...');
	return batchInsert(volunteerRole, VOLUNTEER_ROLE_SEEDS);
}

export const VOLUNTEER_AVAILABILITY = [
	'Weekday evenings, and most Saturdays.',
	'Anytime after 5pm. Weekends are easiest.',
	'Sunday afternoons only — I work six days.',
	'Flexible, just give me a few days notice.',
	'Fridays and Saturdays, load-out included.',
	null,
	null
];

/**
 * Volunteer profiles, and the gate they control.
 *
 * Deliberately not one per member: the last two users are left without a profile
 * so the onboarding flow is reachable on a fresh seed instead of only ever being
 * testable by hand-deleting a row.
 *
 * The minors are the point of the table, so both sides of the override are
 * represented — two waiting in the staff queue, and one already cleared, which
 * still reads as a minor because approval moves `status` and leaves `isAdult`
 * alone. Same philosophy as the deliberately-archived role above.
 *
 * The four named demo logins are seeded separately in `seedVolunteerPersonas`,
 * which owns their profiles too — including the two gate states this function
 * cannot produce for a signed-in user (no profile at all, and blocked).
 */
export async function seedVolunteerProfiles(users: any[], reviewer: any) {
	console.log('Seeding volunteer profiles...');
	if (users.length < 4) return { rows: [], active: users, blocked: 0 };

	// Reserved as "hasn't signed up to volunteer yet".
	const notOnboarded = users.slice(-2);
	const onboarded = users.slice(0, -2);

	// Minors are picked at fixed indices rather than at random so a fresh seed
	// always has the same three to click through — but not from the very front.
	// `users[0]`/`users[1]` hold admin+staff and `users[2]`-`users[4]` hold staff
	// (see `seedUserRoles`), and `allUsers[0]` is the admin itself, so the front
	// of this list is the site's own operators. Filing them in the "Needs review"
	// queue read as a bug. Index 6 is the first plain member.
	const blockedMinors = onboarded.slice(6, 8);
	const approvedMinor = onboarded[8];
	const now = new Date();
	const day = 86_400_000;

	const rows = onboarded.map((u, i) => {
		const [first = u.name, ...rest] = String(u.name).trim().split(/\s+/);
		const isBlockedMinor = blockedMinors.includes(u);
		const isApprovedMinor = u === approvedMinor;
		const isAdult = !isBlockedMinor && !isApprovedMinor;

		return {
			id: randomUUID(),
			userId: u.id,
			firstName: first,
			lastName: rest.join(' ') || 'Member',
			isAdult,
			status: isBlockedMinor ? 'blocked' : 'active',
			// A blocked minor never reached the interests step, so no note either.
			availability: isBlockedMinor ? null : pick(VOLUNTEER_AVAILABILITY),
			approvedByUserId: isApprovedMinor ? reviewer.id : null,
			approvedAt: isApprovedMinor ? new Date(now.getTime() - 3 * day) : null,
			createdAt: new Date(now.getTime() - (i + 1) * day)
		};
	});

	// 11 columns × the default batch of 10 is 110 bound parameters, over D1's
	// 100-variable ceiling for a single statement. 8 × 11 = 88.
	const inserted = await batchInsert(volunteerProfile, rows, 8);

	const blockedIds = new Set(blockedMinors.map((u) => u.id));
	return {
		rows: inserted,
		active: users.filter((u) => !blockedIds.has(u.id) && !notOnboarded.includes(u)),
		blocked: blockedMinors.length
	};
}

/**
 * Standing "I'd help with this" marks. About a third of members put their hand
 * up for something — enough for the staff interest page to have rows and for
 * the per-role filter to actually narrow, without every member matching every
 * role and making the filter look broken.
 */
export async function seedVolunteerInterests(users: any[], roles: any[]) {
	console.log('Seeding volunteer role interests...');
	const liveRoles = roles.filter((r: any) => r.isActive !== false);
	if (liveRoles.length === 0 || users.length === 0) return [];

	const rows = users
		.filter(() => Math.random() < 0.35)
		.flatMap((u: any) =>
			pickN(liveRoles, randomInt(1, 3)).map((role: any) => ({
				id: randomUUID(),
				userId: u.id,
				volunteerRoleId: role.id
			}))
		);

	return batchInsert(volunteerRoleInterest, rows);
}

/**
 * A small certification catalog with every derived state represented: one
 * internal clearance that never lapses, one external card with holders who are
 * current, expiring inside the warning window, and lapsed — so the clearances
 * view has all its tabs populated on a fresh seed.
 */
export async function seedCertifications(users: any[], roles: any[]) {
	console.log('Seeding certifications...');
	const now = new Date();
	const day = 86_400_000;

	const [deskCert, foodCert] = await batchInsert(volunteerCertification, [
		{
			id: randomUUID(),
			name: 'Sound Desk Cleared',
			description:
				'Cleared to run the desk unsupervised. Ask a staff engineer to sign you off after two shadowed shifts.',
			issuedBy: null,
			validityMonths: null,
			displayOrder: 10
		},
		{
			id: randomUUID(),
			name: 'Food Handler',
			description: 'Oregon Food Handler card, required for concessions.',
			issuedBy: 'Oregon Health Authority',
			validityMonths: 36,
			displayOrder: 20
		}
	]);

	// Sound Engineering requires the desk clearance, so the member shift board
	// has a visibly gated role out of the box.
	const soundRole = roles.find((r: any) => r.name === 'Sound Engineering');
	if (soundRole) {
		await db
			.insert(volunteerRoleCertification)
			.values({ volunteerRoleId: soundRole.id, certificationId: deskCert.id });
	}

	// Front Desk requires the food card, and that link is load-bearing rather
	// than decorative. `listLapsingBeforeRosteredShift` only ever returns a grant
	// with a non-null `expiresAt` reached through `volunteer_role_certification`,
	// and the desk clearance above never expires — so while Sound Engineering was
	// the only requirement in the catalog, the dashboard's lapsing card could not
	// have a row on any seed. Food Handler carries `validityMonths`, so every
	// grant of it gets a date, which is what makes that card real.
	const deskRole = roles.find((r: any) => r.name === 'Front Desk');
	if (deskRole) {
		await db
			.insert(volunteerRoleCertification)
			.values({ volunteerRoleId: deskRole.id, certificationId: foodCert.id });
	}

	const holders = pickN(users, Math.min(6, users.length));
	const held = await batchInsert(
		memberCertification,
		holders.flatMap((u: any, i: number) => {
			const rows: any[] = [
				{
					id: randomUUID(),
					userId: u.id,
					certificationId: deskCert.id,
					grantedAt: new Date(now.getTime() - (30 + i * 10) * day),
					expiresAt: null
				}
			];
			// Rotate the card states: current / expiring soon / lapsed.
			const granted = new Date(now.getTime() - 300 * day);
			const expires =
				i % 3 === 0
					? new Date(now.getTime() + 400 * day)
					: i % 3 === 1
						? new Date(now.getTime() + 30 * day)
						: new Date(now.getTime() - 20 * day);
			rows.push({
				id: randomUUID(),
				userId: u.id,
				certificationId: foodCert.id,
				grantedAt: granted,
				expiresAt: expires
			});
			return rows;
		})
	);

	// The certification rows travel out, not just their count: `seedVolunteerPersonas`
	// grants against these two by id.
	return { certs: 2, held: held.length, deskCert, foodCert };
}

/**
 * A fortnight of shifts either side of today: past ones completed with
 * feedback, today's confirmed, upcoming ones part-claimed so the staff list
 * shows real needed-vs-claimed numbers and the member board has things to take.
 */
export async function seedVolunteerShifts(users: any[], roles: any[], events: SeedEvent[]) {
	console.log('Seeding volunteer shifts...');
	const liveRoles = roles.filter((r: any) => r.isActive !== false);
	if (liveRoles.length === 0 || users.length === 0) return { shifts: 0, signups: 0, feedback: 0 };

	const now = new Date();
	const day = 86_400_000;
	const at = (daysOffset: number, hour: number) => {
		const d = new Date(now.getTime() + daysOffset * day);
		d.setHours(hour, 0, 0, 0);
		return d;
	};

	// Most volunteer shifts staff a show, so most of the seeded ones carry an
	// event — but not all of them. Work parties and gear-repair days are why
	// `eventId` is nullable, and both branches of every "linked to an event?"
	// check need data or nobody sees the unlinked rendering until production.
	//
	// Attached shifts take their times *from the show*, half an hour before doors
	// through the end of the night. A shift pointing at a gig on some other
	// evening would be worse than no link at all.
	const published = events.filter((e) => e.status === 'published');
	const pastShows = published.filter((e) => e.startsAt < now);
	const futureShows = published.filter((e) => e.startsAt >= now);

	const shiftRows = await batchInsert(
		volunteerShift,
		[-10, -7, -4, -2, 1, 2, 4, 6, 8, 11].map((offset, i) => {
			// Every third shift is deliberately left unattached.
			const pool = offset < 0 ? pastShows : futureShows;
			const show = i % 3 === 2 ? undefined : pool[Math.floor(i / 3) % (pool.length || 1)];

			const startsAt = show ? new Date(show.startsAt.getTime() - 30 * 60_000) : at(offset, 18);
			const endsAt = show
				? (show.endsAt ?? new Date(show.startsAt.getTime() + 4 * 3_600_000))
				: at(offset, 22);

			return {
				id: randomUUID(),
				volunteerRoleId: pick(liveRoles).id,
				eventId: show?.id ?? null,
				startsAt,
				endsAt,
				// One deliberately over-subscribed shift, so the staff dashboard's
				// short-staffed card has something to show. Every seeded shift used to
				// fill exactly, which made the card correct and permanently empty — and
				// an empty card is indistinguishable from a broken one.
				//
				// Offset 2 specifically: it is one of the unattached shifts (`i % 3 === 2`),
				// so its date comes from the offset rather than from whichever show it was
				// paired with — which is what keeps it inside the dashboard's two-week
				// horizon rather than wherever the events happen to fall.
				capacity: offset === 2 ? 4 : 1 + (i % 3),
				notes: i % 2 === 0 ? 'Meet at the side door 15 minutes early.' : null
			};
		}),
		// One more bound column per row than this insert used to carry, and D1 caps
		// a statement at 100 parameters.
		8
	);

	const signupRows: any[] = [];
	const feedbackRows: any[] = [];
	// Completed signups travel out to `seedVolunteerHours`, which writes an hour
	// log against half of them — see the note there.
	const completions: {
		signupId: string;
		shiftId: string;
		userId: string;
		volunteerRoleId: string;
		startsAt: Date;
		endsAt: Date;
	}[] = [];

	// The most recent shift that has already finished. Its first claim is left
	// unconfirmed on purpose — see the note where the status is picked.
	const strandedShiftId = shiftRows
		.filter((sh: any) => sh.startsAt < now)
		.sort((a: any, b: any) => b.startsAt.getTime() - a.startsAt.getTime())[0]?.id;

	for (const [shiftIndex, shift] of shiftRows.entries()) {
		const isPast = shift.startsAt < now;
		// Deliberately one short on the roomiest upcoming shift, so the staff dashboard's
		// short-staffed card and the `+N unconfirmed` badge both have real data. Every
		// seeded shift used to fill exactly, which left every "needs attention" surface
		// permanently empty and therefore untested by eye.
		//
		// The rest of the upcoming shifts now leave a place open too, for the
		// member's side of the same problem: filling every one of them turned the
		// whole open-shift board into "Full" rows with nothing to claim. The first
		// one still fills exactly, because the full rendering needs a row as well.
		const wanted = isPast
			? shift.capacity
			: shift.capacity >= 4
				? shift.capacity - 2
				: shiftIndex === 0
					? shift.capacity
					: shift.capacity - 1;
		const takers = pickN(users, Math.min(wanted, users.length));
		for (const [i, u] of takers.entries()) {
			const signupId = randomUUID();
			// Upcoming shifts mix claimed and confirmed; past ones completed, with
			// the occasional no-show so the detail view shows the whole vocabulary.
			// The last shift to have finished keeps one claim nobody confirmed. That is
			// the state the close-out card exists for: `complete-shifts` only promotes
			// confirmed signups, so it never completed, no hour log was ever offered
			// and no feedback was asked for — and until the dashboard, nothing said so.
			const strandedClaim = shift.id === strandedShiftId && i === 0;
			const status = strandedClaim
				? 'claimed'
				: isPast
					? i === 0 && Math.random() < 0.2
						? 'no_show'
						: 'completed'
					: i === 0
						? 'confirmed'
						: 'claimed';
			signupRows.push({
				id: signupId,
				shiftId: shift.id,
				userId: u.id,
				status,
				// Five days before the shift, but never in the future: a claim is something
				// somebody already did, and the dashboard renders it as "claimed
				// <relative day>". Derived straight from the shift date it read "claimed
				// in 3 weeks" for anything more than five days out.
				claimedAt: new Date(Math.min(shift.startsAt.getTime() - 5 * day, now.getTime())),
				confirmedAt:
					status === 'claimed'
						? null
						: new Date(Math.min(shift.startsAt.getTime() - 4 * day, now.getTime())),
				completedAt: status === 'completed' ? shift.endsAt : null
			});
			if (status === 'completed') {
				completions.push({
					signupId,
					shiftId: shift.id,
					userId: u.id,
					volunteerRoleId: shift.volunteerRoleId,
					startsAt: shift.startsAt,
					endsAt: shift.endsAt
				});
			}
			if (status === 'completed' && Math.random() < 0.7) {
				feedbackRows.push({
					id: randomUUID(),
					signupId,
					rating: 3 + Math.floor(Math.random() * 3),
					wasSetUp: Math.random() < 0.75,
					comment:
						Math.random() < 0.5
							? pick([
									'Smooth night, good crowd.',
									'Could use a checklist by the door.',
									'Nobody told me where the float was kept.',
									'More gaff tape by the desk, please.'
								])
							: null,
					submittedAt: new Date(shift.endsAt.getTime() + day)
				});
			}
		}
	}

	// 8 cols x default 10 rows = 80 bound params — inside D1's 100 ceiling, but
	// batch smaller anyway to stay clear of drizzle's own additions.
	const signups = await batchInsert(volunteerSignup, signupRows, 8);
	const feedback = await batchInsert(volunteerShiftFeedback, feedbackRows, 8);

	return {
		shifts: shiftRows.length,
		signups: signups.length,
		feedback: feedback.length,
		completions
	};
}

/**
 * Hour logs, in two halves.
 *
 * `completions` carries the shifts somebody actually worked, and half of them
 * get a log pointing back at the shift. `shift_id` was nullable and permanently
 * null before that, so nothing in the app ever rendered the link between a
 * worked shift and the hours it produced. Half rather than all, because the
 * unlinked half is what `listUnloggedCompletions` feeds — the member dashboard's
 * "log these hours" prefill needs completions that still have no log.
 *
 * The rest is the weighted random bulk: enough pending work to fill the queue on
 * first load, and enough approved history for the report to be worth opening.
 */
export async function seedVolunteerHours(
	users: any[],
	roles: any[],
	completions: {
		shiftId: string;
		userId: string;
		volunteerRoleId: string;
		startsAt: Date;
		endsAt: Date;
	}[] = []
) {
	console.log('Seeding volunteer hour logs...');
	if (roles.length === 0 || users.length === 0) return [];

	// Weighted so the queue has real work on first load, and the report has
	// enough approved history to be worth opening.
	const STATUS_MIX = [
		...Array(10).fill('pending'),
		...Array(36).fill('approved'),
		...Array(4).fill('rejected')
	] as const;

	const volunteers = pickN(users, Math.min(10, users.length));
	const reviewer = users[0];
	const archivedRole = roles.find((r: any) => !r.isActive);
	const activeRoles = roles.filter((r: any) => r.isActive);

	const day = 86_400_000;
	const linked = completions
		.filter((_, i) => i % 2 === 0)
		.map((c) => {
			const daysAgo = Math.max(0, Math.round((Date.now() - c.startsAt.getTime()) / day));
			const workedOn = ptDate(-daysAgo, 12);
			const worked = Math.round((c.endsAt.getTime() - c.startsAt.getTime()) / 60_000);
			return {
				userId: c.userId,
				volunteerRoleId: c.volunteerRoleId,
				shiftId: c.shiftId,
				workedOn,
				// Clamped to the per-log ceiling in `src/lib/config.ts`; a shift that
				// runs from doors to close can otherwise outlast it.
				minutes: Math.min(Math.max(worked, 30), 720),
				description: pick(VOLUNTEER_DESCRIPTIONS),
				status: 'approved' as const,
				reviewedByUserId: users[0].id,
				reviewedAt: new Date(workedOn.getTime() + 2 * day),
				reviewNotes: null
			};
		});

	const bulk = STATUS_MIX.map((status, i) => {
		// A few logs against the archived role, so the report has to prove it
		// still resolves retired roles.
		const role = archivedRole && i % 17 === 0 ? archivedRole : pick(activeRoles);
		const workedOn = ptDate(-randomInt(1, 180), 12);
		const reviewed = status !== 'pending';

		return {
			userId: pick(volunteers).id,
			volunteerRoleId: role.id,
			shiftId: null,
			workedOn,
			minutes: pick([60, 90, 120, 180, 240, 300]),
			description: pick(VOLUNTEER_DESCRIPTIONS),
			status,
			reviewedByUserId: reviewed ? reviewer.id : null,
			reviewedAt: reviewed ? new Date(workedOn.getTime() + 2 * 24 * 60 * 60 * 1000) : null,
			reviewNotes: status === 'rejected' ? pick(VOLUNTEER_REJECT_NOTES) : null
		};
	});

	// 13 columns × the default batch of 10 is 130 bound parameters, over D1's
	// 100-variable ceiling for a single statement. 7 × 13 = 91.
	return batchInsert(volunteerHourLog, [...linked, ...bulk], 7);
}
