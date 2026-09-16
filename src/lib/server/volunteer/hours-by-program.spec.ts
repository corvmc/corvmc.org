import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Hours attributed to a program, against a real SQLite.
 *
 * Both halves are `WHERE` clauses a mocked `db` would wave through: that a
 * member may only name a committee or club they actually belong to, and that
 * the by-program report groups and excludes correctly.
 */

/** The whole schema, replayed from the committed migrations. Why: #847. */
const { sqlite, testDb } = await vi.hoisted(async () => {
	// `await import`, not `require`: the helper is TypeScript, which Node's
	// require cannot load. An async hoisted factory still resolves before the
	// mock below is asked for a database.
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

vi.mock('$lib/server/db', () => ({
	db: testDb,
	getRowCount: (result: unknown) => (result as { changes?: number })?.changes ?? 0
}));

vi.mock('$lib/server/volunteer/volunteer-profile-service', () => ({
	requireActiveVolunteer: vi.fn(async () => undefined)
}));
vi.mock('$lib/server/events', () => ({ domainEvents: { emit: vi.fn(async () => undefined) } }));
vi.mock('$lib/server/sentry', () => ({ captureException: vi.fn() }));

const { submitHours } = await import('./hour-log-service');
const { getHoursByGroup } = await import('./volunteer-report-service');

const MEMBER = 'usr-member';
const OUTSIDER = 'usr-outsider';
const ROLE = 'role-program-work';
const COMMITTEE = 'grp-booking';
const CLUB = 'grp-club';
const BAND = 'grp-band';

async function seed() {
	const { user } = await import('$lib/server/db/schema/authentication');
	const { group, groupMember } = await import('$lib/server/db/schema/group');
	const { volunteerRole } = await import('$lib/server/db/schema/volunteer');

	await testDb.insert(user).values([
		{ id: MEMBER, name: 'Ada', email: 'ada@example.com', emailVerified: false },
		{ id: OUTSIDER, name: 'Bo', email: 'bo@example.com', emailVerified: false }
	] as never);
	await testDb.insert(volunteerRole).values({
		id: ROLE,
		name: 'Program Work',
		group: 'away-from-shows',
		isActive: true
	} as never);
	await testDb.insert(group).values([
		{ id: COMMITTEE, kind: 'committee', name: 'Booking Committee', slug: 'booking-committee' },
		{ id: CLUB, kind: 'club', name: 'Real Book Club', slug: 'real-book-club' },
		{ id: BAND, kind: 'band', name: 'A Band', slug: 'a-band' }
	] as never);
	// The member is on all three; the outsider is on none.
	await testDb.insert(groupMember).values(
		[COMMITTEE, CLUB, BAND].map((groupId, i) => ({
			id: `gm-${i}`,
			groupId,
			userId: MEMBER,
			role: 'member' as const,
			status: 'active' as const
		}))
	);
}

// Today, because submission refuses anything older than the backdate limit.
const today = () => new Date().toISOString().slice(0, 10);

const log = (over: Record<string, unknown> = {}) => ({
	volunteerRoleId: ROLE,
	workedOn: today(),
	minutes: 60,
	description: 'Monthly meeting',
	...over
});

beforeEach(async () => {
	for (const t of ['volunteer_hour_log', 'group_member', 'volunteer_role', '"group"', 'user']) {
		sqlite.exec(`delete from ${t}`);
	}
	await seed();
});

describe('naming a program on a log', () => {
	it('accepts a committee the member is on', async () => {
		const row = await submitHours(MEMBER, log({ groupId: COMMITTEE }));
		expect(row.groupId).toBe(COMMITTEE);
	});

	it('accepts a club, which is why this is not committee-only', async () => {
		const row = await submitHours(MEMBER, log({ groupId: CLUB }));
		expect(row.groupId).toBe(CLUB);
	});

	/** A band is its own members' business, not volunteering for the Collective. */
	it('refuses a band the member is genuinely on', async () => {
		await expect(submitHours(MEMBER, log({ groupId: BAND }))).rejects.toThrow(/committee or club/i);
	});

	it('refuses a program the member does not belong to', async () => {
		await expect(submitHours(OUTSIDER, log({ groupId: COMMITTEE }))).rejects.toThrow(
			/committee or club/i
		);
	});

	it('leaves it null when nothing is named, which is most volunteering', async () => {
		const row = await submitHours(MEMBER, log());
		expect(row.groupId).toBeNull();
	});
});

describe('getHoursByGroup', () => {
	async function approved(groupId: string | null, minutes: number, userId = MEMBER) {
		const { volunteerHourLog } = await import('$lib/server/db/schema/volunteer');
		const row = await submitHours(userId, log({ groupId: groupId ?? undefined, minutes }));
		await testDb
			.update(volunteerHourLog)
			.set({ status: 'approved' })
			.where(await import('drizzle-orm').then((d) => d.eq(volunteerHourLog.id, row.id)));
	}

	it('sums by program, largest first', async () => {
		await approved(COMMITTEE, 60);
		await approved(COMMITTEE, 120);
		await approved(CLUB, 30);

		const rows = await getHoursByGroup();

		expect(rows.map((r) => [r.groupName, r.minutes])).toEqual([
			['Booking Committee', 180],
			['Real Book Club', 30]
		]);
	});

	it('leaves out hours that named no program', async () => {
		// An outer join would put the whole of CMC-at-large under a blank row,
		// which reads as a program with no name.
		await approved(null, 600);
		await approved(COMMITTEE, 60);

		const rows = await getHoursByGroup();

		expect(rows).toHaveLength(1);
		expect(rows[0].minutes).toBe(60);
	});

	it('counts a person once however many logs they file', async () => {
		await approved(COMMITTEE, 60);
		await approved(COMMITTEE, 60);
		expect((await getHoursByGroup())[0].volunteerCount).toBe(1);
	});

	it('counts only approved hours, like every other line on the report', async () => {
		await submitHours(MEMBER, log({ groupId: COMMITTEE }));
		expect(await getHoursByGroup()).toEqual([]);
	});
});
