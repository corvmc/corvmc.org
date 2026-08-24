import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `getUserOverview` is the one query the staff user record cannot defer: it
 * feeds the identity badges, the scoreboard, every tab badge and the whole
 * Overview tab before anyone has clicked anything.
 *
 * What is worth pinning here is the derivation, not the SQL. The counts are
 * plain `count()` reads; the parts that can be wrong in a way nobody notices
 * are the judgements layered on top — which certifications "need attention",
 * which band memberships are real, what counts as sustaining. Those are what
 * these tests hold.
 */

// Every db read resolves to the same empty/zero shape except the first two,
// which are the band-membership and account lookups the rest of the function
// branches on. They are issued before the count fan-out, in that order.
let selectCall = 0;
let memberships: Array<{ bandId: string; name: string; status: string }> = [];
let directoryVisibility = 'members';

const dbSelect = vi.fn(() => {
	selectCall += 1;
	const call = selectCall;
	const b = {
		from: () => b,
		innerJoin: () => b,
		leftJoin: () => b,
		where: () => b,
		orderBy: () => b,
		limit: () => b,
		groupBy: () => b,
		$dynamic: () => b,
		then: (resolve: (v: unknown) => unknown) => {
			if (call === 1) return resolve(memberships);
			if (call === 2) return resolve([{ directoryVisibility }]);
			return resolve([{ count: 0, cents: 0 }]);
		}
	};
	return b;
});

vi.mock('$lib/server/db', () => ({ db: { select: (...a: unknown[]) => dbSelect(...(a as [])) } }));

const getAllBalances = vi.fn(async () => ({ free_hours: 12, equipment_credits: 2 }));
vi.mock('$lib/server/finance/credit-service', () => ({
	getAllBalances: (...a: unknown[]) => getAllBalances(...(a as []))
}));

let subscription: Record<string, unknown> | null = null;
vi.mock('$lib/server/finance/subscription-service', () => ({
	getMemberSubscription: vi.fn(async () => subscription),
	mapDbSubscription: vi.fn((sub: Record<string, unknown> | null) =>
		sub ? { id: 'sub_1', currentPeriodEnd: new Date('2026-09-01') } : null
	)
}));

// One call now covers every scope, which is the point of the merge: the
// overview used to make one round trip per domain.
const standing = (status: string, reason: string | null = null) => ({
	status,
	reason,
	triggeringFlagId: null,
	updatedAt: null
});
let standings = {
	community_event: standing('restricted', 'Upheld report'),
	suggestion: standing('none'),
	messaging: standing('none')
};
vi.mock('$lib/server/moderation/standing-service', () => ({
	getStandings: vi.fn(async () => standings)
}));

vi.mock('$lib/server/volunteer/hour-log-service', () => ({
	getUserHourSummary: vi.fn(async () => ({
		approvedMinutes: 600,
		pendingMinutes: 60,
		approvedMinutesThisYear: 300,
		logCount: 4
	}))
}));

let certifications: Array<{ state: string; revokedAt: Date | null }> = [];
vi.mock('$lib/server/volunteer/member-certification-service', () => ({
	listForUser: vi.fn(async () => certifications)
}));

let volunteerProfile: { status: string } | null = null;
vi.mock('$lib/server/volunteer/volunteer-profile-service', () => ({
	getVolunteerProfile: vi.fn(async () => volunteerProfile),
	stageOf: (p: { status: string } | null) =>
		!p ? 'none' : p.status === 'blocked' ? 'blocked' : 'active'
}));

vi.mock('$lib/server/directory/directory-service', () => ({
	isProfileComplete: vi.fn(async () => false)
}));

let subscriber: Record<string, unknown> | null = null;
vi.mock('$lib/server/marketing/subscriber-service', () => ({
	findByUserId: vi.fn(async () => subscriber)
}));

vi.mock('$lib/server/inbox/portal-service', () => ({
	countPortalUnread: vi.fn(async () => 1)
}));

vi.mock('./user-service', () => ({
	getLastLoginAt: vi.fn(async () => new Date('2026-08-01T10:00:00Z'))
}));

const { getUserOverview } = await import('./user-overview-service');

beforeEach(() => {
	vi.clearAllMocks();
	selectCall = 0;
	memberships = [];
	directoryVisibility = 'members';
	subscription = null;
	certifications = [];
	volunteerProfile = null;
	subscriber = null;
	standings = {
		community_event: standing('restricted', 'Upheld report'),
		suggestion: standing('none'),
		messaging: standing('none')
	};
});

describe('getUserOverview', () => {
	it('returns band names, and keeps pending invitations out of the active list', async () => {
		// The record shows bands as links, so the names ride out on the join that
		// was already resolving membership — a count would have sent staff to a
		// tab to find out which bands it meant. A never-accepted invitation is not
		// a band they are in, but it is something staff need to see, so it stays
		// in the list carrying its own status and is counted separately.
		memberships = [
			{ bandId: 'b1', name: 'The Hague', status: 'active' },
			{ bandId: 'b2', name: 'Wet Dog', status: 'active' },
			{ bandId: 'b3', name: 'Slow Corners', status: 'pending' }
		];

		const overview = await getUserOverview('u1');

		expect(overview.bands).toEqual([
			{ id: 'b1', name: 'The Hague', status: 'active' },
			{ id: 'b2', name: 'Wet Dog', status: 'active' },
			{ id: 'b3', name: 'Slow Corners', status: 'pending' }
		]);
		expect(overview.counts.pendingBandInvites).toBe(1);
	});

	/**
	 * Regression: this function fanned out to ~29 statements on every member
	 * view, a third of them feeding a twelve-tile grid on the Overview tab that
	 * only restated what each tab already showed. The grid is gone. Nothing here
	 * should be computed because it might be interesting — every count must have
	 * a reader, and this is the guard that says so.
	 */
	it('reads nothing it does not return', async () => {
		memberships = [{ bandId: 'b1', name: 'The Hague', status: 'active' }];

		const overview = await getUserOverview('u1');

		// Two lookups (memberships, account) plus one statement per count that
		// comes from the database: reservations upcoming/unpaid, overdue loans,
		// pending hour logs, open flags, lifetime paid.
		expect(dbSelect.mock.calls).toHaveLength(8);
		expect(Object.keys(overview.counts).sort()).toEqual([
			'approvedMinutesThisYear',
			'certsNeedingAttention',
			'lifetimePaidCents',
			'openFlagsAgainst',
			'overdueLoans',
			'pendingBandInvites',
			'pendingHourLogs',
			'unpaidReservations',
			'unreadThreads',
			'upcomingReservations'
		]);
	});

	it('treats expiring and expired clearances as needing attention, but not revoked ones', async () => {
		// A revoked clearance was a deliberate act and is already resolved.
		// Counting it would leave a permanent warning on the record with nothing
		// anyone could do about it.
		certifications = [
			{ state: 'current', revokedAt: null },
			{ state: 'expiring', revokedAt: null },
			{ state: 'expired', revokedAt: null },
			{ state: 'revoked', revokedAt: new Date('2026-01-01') }
		];

		const overview = await getUserOverview('u1');

		expect(overview.counts.certsNeedingAttention).toBe(2);
	});

	it('derives sustaining membership from the stored subscription snapshot', async () => {
		expect((await getUserOverview('u1')).membership.sustaining).toBe(false);

		selectCall = 0;
		subscription = { hoursPerReset: 8, cancelAtPeriodEnd: true };
		const overview = await getUserOverview('u1');

		expect(overview.membership.sustaining).toBe(true);
		expect(overview.membership.cancelAtPeriodEnd).toBe(true);
		expect(overview.membership.hoursPerReset).toBe(8);
	});

	it('keeps suggestion standing separate from listing standing', async () => {
		// An upheld report about an event must not cost someone their
		// suggestion-posting rights, or the reverse — so the two are read and
		// reported independently rather than folded into one flag.
		standings = { ...standings, suggestion: standing('restricted', 'Off-topic posts') };

		const overview = await getUserOverview('u1');

		expect(overview.standings.community_event.status).toBe('restricted');
		expect(overview.standings.suggestion).toMatchObject({
			status: 'restricted',
			reason: 'Off-topic posts'
		});
	});

	it('surfaces marketing suppression with its reason', async () => {
		subscriber = { suppressedAt: new Date('2026-05-01'), suppressionReason: 'bounce' };

		const overview = await getUserOverview('u1');

		expect(overview.marketing).toEqual({ suppressed: true, suppressionReason: 'bounce' });
	});

	it('reports a blocked volunteer as blocked, and a missing profile as none', async () => {
		expect((await getUserOverview('u1')).volunteer.stage).toBe('none');

		selectCall = 0;
		volunteerProfile = { status: 'blocked' };
		expect((await getUserOverview('u1')).volunteer.stage).toBe('blocked');
	});

	it('passes through standing, directory state and last login', async () => {
		directoryVisibility = 'hidden';

		const overview = await getUserOverview('u1');

		expect(overview.standings.community_event).toMatchObject({
			status: 'restricted',
			reason: 'Upheld report'
		});
		expect(overview.directory).toEqual({ visibility: 'hidden', profileComplete: false });
		expect(overview.lastLoginAt).toEqual(new Date('2026-08-01T10:00:00Z'));
		expect(overview.counts.approvedMinutesThisYear).toBe(300);
		expect(overview.counts.unreadThreads).toBe(1);
	});
});
