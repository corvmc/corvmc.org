import { account, user } from '../../src/lib/server/db/schema/authentication';
import { modelHasRole } from '../../src/lib/server/db/schema/authorization';
import {
	memberCertification,
	volunteerHourLog,
	volunteerProfile,
	volunteerRoleInterest,
	volunteerShift,
	volunteerShiftFeedback,
	volunteerSignup
} from '../../src/lib/server/db/schema/volunteer';
import { batchInsert, db } from './db';
import { scryptHash } from './hash';
import { type SeedRole } from './types';
import { ptDate } from './util';

/**
 * The four named demo logins, and everything that has to exist for them.
 *
 * The seed used to give exactly one account a password, which meant the only
 * volunteer anybody could sign in as was also an admin — and the member-facing
 * half of the module is gated on onboarding stage, so three of its five pages
 * were unreachable from a browser. `gate()` routes `none` to /start, `blocked`
 * to /blocked and `active` to the dashboard, and those states are mutually
 * exclusive per user, so seeing all three takes three accounts. The fourth is a
 * coordinator: `requireStaff()` accepts `staff` alone, so she reaches every
 * /staff/volunteer page while the admin-only nav stays hidden, which is what
 * the coordinator's view of the app actually looks like.
 *
 * Everything here is deterministic — no `pick`, `pickN` or `randomInt`. The
 * randomised bulk above is what makes the app look lived-in; these rows are
 * what a screenshot, a demo or a bug report can be pointed at by name. The two
 * touch through nothing but the shared role and certification catalogs.
 *
 * They are deliberately NOT part of `allUsers`. `seedVolunteerProfiles` slices
 * that array and `seedUserRoles` indexes into it, so appending would silently
 * reassign both, and staying out of it also keeps the random certification
 * holders from colliding with the revoked grant below.
 */
export const VOLUNTEER_PERSONAS = [
	{
		id: 'seed-vol-coordinator',
		email: 'coordinator@corvallismusic.org',
		name: 'Nia Okafor',
		memberNumber: 90,
		roles: ['staff', 'member']
	},
	{
		id: 'seed-vol-active',
		email: 'volunteer@corvallismusic.org',
		name: 'Sam Whitfield',
		memberNumber: 91,
		roles: ['member', 'volunteer']
	},
	{
		id: 'seed-vol-newcomer',
		email: 'newcomer@corvallismusic.org',
		name: 'Ellis Park',
		memberNumber: 92,
		roles: ['member']
	},
	{
		id: 'seed-vol-minor',
		email: 'minor@corvallismusic.org',
		name: 'Robin Vance',
		memberNumber: 93,
		roles: ['member']
	}
] as const;

export async function seedVolunteerPersonas(
	roles: SeedRole[],
	volunteerRoles: any[],
	certifications: { deskCert?: any; foodCert?: any },
	reviewer: any
) {
	console.log('Seeding volunteer personas...');
	const roleByName = new Map(roles.map((r) => [r.name, r.id]));
	const vroleByName = new Map(volunteerRoles.map((r: any) => [r.name, r]));
	const frontDesk = vroleByName.get('Front Desk');
	const eventSetup = vroleByName.get('Event Setup');
	const loadOut = vroleByName.get('Load-Out & Teardown');
	const outreach = vroleByName.get('Outreach & Tabling');
	if (!frontDesk || !eventSetup || !loadOut || !outreach) return { users: 0 };

	const now = new Date();
	const day = 86_400_000;
	const ago = (days: number) => new Date(now.getTime() - days * day);
	const ahead = (days: number) => new Date(now.getTime() + days * day);
	// A shift on a given day, 18:00 to 18:00 + duration, in local time — the same
	// shape `seedVolunteerShifts` uses for its unattached rows.
	const shiftAt = (dayOffset: number, hour: number, minutes: number) => {
		const startsAt = new Date(now.getTime() + dayOffset * day);
		startsAt.setHours(hour, 0, 0, 0);
		return { startsAt, endsAt: new Date(startsAt.getTime() + minutes * 60_000) };
	};

	for (const p of VOLUNTEER_PERSONAS) {
		await db.insert(user).values({
			id: p.id,
			name: p.name,
			email: p.email,
			emailVerified: true,
			memberNumber: p.memberNumber,
			createdAt: ago(400),
			updatedAt: ago(400)
		});
		// Hashed per persona rather than once and reused, so every row carries its
		// own salt like a real signup would.
		await db.insert(account).values({
			id: `${p.id}-credential`,
			accountId: p.id,
			providerId: 'credential',
			userId: p.id,
			password: await scryptHash('password'),
			createdAt: ago(400),
			updatedAt: ago(400)
		});
		for (const roleName of p.roles) {
			const roleId = roleByName.get(roleName);
			if (roleId) await db.insert(modelHasRole).values({ roleId, userId: p.id });
		}
	}

	// Profiles for two of the four. The newcomer gets none — that absence is what
	// /member/volunteer/start exists to handle — and the minor is blocked, which
	// is the state the under-18 queue works.
	await batchInsert(
		volunteerProfile,
		[
			{
				id: 'seed-vol-profile-coordinator',
				userId: 'seed-vol-coordinator',
				firstName: 'Nia',
				lastName: 'Okafor',
				isAdult: true,
				status: 'active',
				availability: 'Most evenings, and every show night I am not already on the books.',
				createdAt: ago(380)
			},
			{
				id: 'seed-vol-profile-active',
				userId: 'seed-vol-active',
				firstName: 'Sam',
				lastName: 'Whitfield',
				isAdult: true,
				status: 'active',
				availability: 'Weeknights after 6, and Saturdays if I know a week ahead.',
				createdAt: ago(210)
			},
			{
				id: 'seed-vol-profile-minor',
				userId: 'seed-vol-minor',
				firstName: 'Robin',
				lastName: 'Vance',
				isAdult: false,
				status: 'blocked',
				availability: null,
				createdAt: ago(2)
			}
		],
		8
	);

	// Six shifts owned outright by the personas, rather than folded into the bulk
	// map above — that map's offsets and event pairings are load-bearing for the
	// short-staffed card, and every count in it is quoted in the seed summary.
	const shifts = [
		{
			id: 'seed-vol-shift-upcoming',
			volunteerRoleId: frontDesk.id,
			...shiftAt(30, 18, 240),
			capacity: 2,
			notes: 'Float is in the drawer under the register.'
		},
		{
			id: 'seed-vol-shift-claimed',
			volunteerRoleId: eventSetup.id,
			...shiftAt(6, 15, 120),
			capacity: 3,
			notes: 'Meet at the side door 15 minutes early.'
		},
		{
			id: 'seed-vol-shift-open',
			volunteerRoleId: loadOut.id,
			...shiftAt(3, 22, 90),
			capacity: 4,
			notes: null
		},
		{
			id: 'seed-vol-shift-feedback',
			volunteerRoleId: frontDesk.id,
			...shiftAt(-2, 18, 240),
			capacity: 1,
			notes: null
		},
		{
			id: 'seed-vol-shift-unlogged',
			volunteerRoleId: eventSetup.id,
			...shiftAt(-5, 15, 120),
			capacity: 1,
			notes: null
		},
		{
			// Cancelled, with its claimants left where they were. That mirrors
			// `cancelShift`, which deliberately does not touch signups — the people
			// who signed up still need telling. Nothing else in the seed sets
			// `cancelledAt`, so the strikethrough rendering and the "include
			// cancelled" filter had no data at all.
			id: 'seed-vol-shift-cancelled',
			volunteerRoleId: outreach.id,
			...shiftAt(9, 11, 180),
			capacity: 2,
			notes: 'Farmers market table — bring the banner from the office.',
			cancelledAt: ago(2),
			cancelledByUserId: 'seed-vol-coordinator'
		}
	].map((sh) => ({ ...sh, eventId: null, createdByUserId: 'seed-vol-coordinator' }));
	await batchInsert(volunteerShift, shifts, 8);

	const byId = new Map(shifts.map((sh) => [sh.id, sh]));
	const shiftEnd = (id: string) => byId.get(id)!.endsAt;
	const shiftStart = (id: string) => byId.get(id)!.startsAt;

	await batchInsert(
		volunteerSignup,
		[
			{
				id: 'seed-vol-signup-upcoming',
				shiftId: 'seed-vol-shift-upcoming',
				userId: 'seed-vol-active',
				status: 'confirmed',
				claimedAt: ago(6),
				confirmedAt: ago(4)
			},
			{
				id: 'seed-vol-signup-claimed',
				shiftId: 'seed-vol-shift-claimed',
				userId: 'seed-vol-active',
				status: 'claimed',
				claimedAt: ago(1)
			},
			{
				// A dropped claim, so `cancelled` is in the vocabulary somewhere. It
				// also leaves the load-out shift wholly empty, which guarantees the
				// member board has something claimable however the random bulk falls.
				id: 'seed-vol-signup-dropped',
				shiftId: 'seed-vol-shift-open',
				userId: 'seed-vol-coordinator',
				status: 'cancelled',
				claimedAt: ago(5),
				cancelledAt: ago(2)
			},
			{
				// Worked, hours already filed, feedback NOT given — this is the one
				// /member/volunteer/feedback/[signupId] is reachable through.
				id: 'seed-vol-signup-feedback',
				shiftId: 'seed-vol-shift-feedback',
				userId: 'seed-vol-active',
				status: 'completed',
				claimedAt: ago(9),
				confirmedAt: ago(7),
				completedAt: shiftEnd('seed-vol-shift-feedback')
			},
			{
				// The mirror image: feedback given, hours still owed, so the member
				// dashboard's "log these hours" prefill always has a row.
				id: 'seed-vol-signup-unlogged',
				shiftId: 'seed-vol-shift-unlogged',
				userId: 'seed-vol-active',
				status: 'completed',
				claimedAt: ago(12),
				confirmedAt: ago(10),
				completedAt: shiftEnd('seed-vol-shift-unlogged')
			},
			{
				// Two people on the called-off shift, one told and one not, because
				// the cancelled shift's whole job is being a notify list and a list
				// where every row reads the same proves nothing. Sam is the
				// outstanding one, so the banner reads "1 to notify".
				id: 'seed-vol-signup-cancelled',
				shiftId: 'seed-vol-shift-cancelled',
				userId: 'seed-vol-active',
				status: 'confirmed',
				claimedAt: ago(8),
				confirmedAt: ago(6)
			},
			{
				id: 'seed-vol-signup-cancelled-notified',
				shiftId: 'seed-vol-shift-cancelled',
				userId: 'seed-vol-coordinator',
				status: 'claimed',
				claimedAt: ago(7),
				notifiedAt: ago(2)
			}
		],
		8
	);

	await db.insert(volunteerShiftFeedback).values({
		id: 'seed-vol-feedback-unlogged',
		signupId: 'seed-vol-signup-unlogged',
		rating: 4,
		wasSetUp: true,
		comment: 'Room was ready and the list was on the door. Ran out of gaff tape halfway through.',
		submittedAt: new Date(shiftEnd('seed-vol-shift-unlogged').getTime() + day)
	});

	// Standing "I would help with this" marks, so the open-shift board has
	// something to rank by and the staff roster shows a member with interests.
	await batchInsert(
		volunteerRoleInterest,
		[frontDesk, eventSetup, loadOut].map((r: any, i) => ({
			id: `seed-vol-interest-${i}`,
			userId: 'seed-vol-active',
			volunteerRoleId: r.id
		}))
	);

	const { deskCert, foodCert } = certifications;
	const certRows: any[] = [];
	if (deskCert) {
		certRows.push({
			id: 'seed-vol-cert-desk',
			userId: 'seed-vol-active',
			certificationId: deskCert.id,
			grantedAt: ago(120),
			expiresAt: null,
			grantedByUserId: 'seed-vol-coordinator',
			notes: 'Signed off after two shadowed shifts on the new console.'
		});
		certRows.push({
			// The only revoked grant in the seed, and it has to be somebody whose
			// NEWEST grant for this certification is the revoked one:
			// `listClearances` collapses to the newest row per (member, cert), so a
			// revocation sitting behind a live renewal would never surface. The
			// personas being outside `allUsers` is what guarantees the random holder
			// pick above cannot hand her a competing row.
			id: 'seed-vol-cert-revoked',
			userId: 'seed-vol-coordinator',
			certificationId: deskCert.id,
			grantedAt: ago(400),
			expiresAt: null,
			grantedByUserId: reviewer.id,
			revokedAt: ago(30),
			revokedReason: 'Stepped back from the desk after the console swap; needs re-signoff.',
			revokedByUserId: reviewer.id
		});
	}
	if (foodCert) {
		certRows.push({
			// Expiring inside the 60-day warning window, and Front Desk now requires
			// it — which together are the only reason the dashboard's lapsing card
			// can have a row: the holder is rostered on the Front Desk shift 30 days
			// out, and this card runs out 20 days from now.
			id: 'seed-vol-cert-food',
			userId: 'seed-vol-active',
			certificationId: foodCert.id,
			grantedAt: ago(1080),
			expiresAt: ahead(20),
			grantedByUserId: 'seed-vol-coordinator',
			reference: 'OR-FH-448120'
		});
	}
	if (certRows.length > 0) await batchInsert(memberCertification, certRows, 7);

	// One log in every status, all reviewed by the coordinator rather than the
	// admin, so "Reviewed by Nia Okafor" is what renders. Two of the approved ones
	// are inside the trailing fortnight: /staff/volunteer/report defaults to
	// January 1st through today, and a seed run in early January would otherwise
	// open on an empty report.
	const noon = (daysAgo: number) => ptDate(-daysAgo, 12);
	await batchInsert(
		volunteerHourLog,
		[
			{
				id: 'seed-vol-log-linked',
				userId: 'seed-vol-active',
				volunteerRoleId: frontDesk.id,
				shiftId: 'seed-vol-shift-feedback',
				workedOn: noon(2),
				minutes: Math.round(
					(shiftEnd('seed-vol-shift-feedback').getTime() -
						shiftStart('seed-vol-shift-feedback').getTime()) /
						60_000
				),
				description: 'Covered the door for the Thursday bill.',
				status: 'approved',
				reviewedByUserId: 'seed-vol-coordinator',
				reviewedAt: ago(1)
			},
			{
				id: 'seed-vol-log-approved-recent',
				userId: 'seed-vol-active',
				volunteerRoleId: eventSetup.id,
				shiftId: null,
				workedOn: noon(12),
				minutes: 120,
				description: 'Chairs, PA and the merch table before doors.',
				status: 'approved',
				reviewedByUserId: 'seed-vol-coordinator',
				reviewedAt: ago(10)
			},
			{
				id: 'seed-vol-log-approved-older',
				userId: 'seed-vol-active',
				volunteerRoleId: loadOut.id,
				shiftId: null,
				workedOn: noon(35),
				minutes: 180,
				description: 'Strike, cable coil and floor reset after the all-ages show.',
				status: 'approved',
				reviewedByUserId: 'seed-vol-coordinator',
				reviewedAt: ago(33)
			},
			{
				id: 'seed-vol-log-pending',
				userId: 'seed-vol-active',
				volunteerRoleId: frontDesk.id,
				shiftId: null,
				workedOn: noon(1),
				minutes: 90,
				description: 'Afternoon open hours — signed up two new members.',
				status: 'pending'
			},
			{
				id: 'seed-vol-log-rejected',
				userId: 'seed-vol-active',
				volunteerRoleId: outreach.id,
				shiftId: null,
				workedOn: noon(20),
				minutes: 300,
				description: 'Tabling at the farmers market.',
				status: 'rejected',
				reviewedByUserId: 'seed-vol-coordinator',
				reviewedAt: ago(18),
				reviewNotes:
					'We had you down for two hours on this, not five. Log the corrected time and we will approve it.'
			}
		],
		7
	);

	return { users: VOLUNTEER_PERSONAS.length };
}
