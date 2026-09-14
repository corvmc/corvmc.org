import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Shift invitations, against a real SQLite.
 *
 * The property that matters is negative and easy to regress: an invitation
 * holds no place. Every capacity predicate is an allowlist of the three
 * statuses that do hold one, so a new value stays out by construction — which
 * is exactly the kind of thing that survives until somebody writes `not in`.
 */

/**
 * The whole schema, replayed from the committed migrations.
 *
 * Not `ddlFor(table)` as three sibling specs use: that lifts the `CREATE TABLE`
 * out of the migration that last created it, and `event` was renamed to
 * `event_listing` after creation, so it finds nothing. Replaying every
 * migration is what a rename survives, and it is what `db:migrate:local` does.
 */
const { sqlite, testDb } = vi.hoisted(() => {
	/* eslint-disable @typescript-eslint/no-require-imports */
	const { readFileSync, globSync } = require('node:fs') as typeof import('node:fs');
	const Database = require('better-sqlite3') as typeof import('better-sqlite3');
	const { drizzle } =
		require('drizzle-orm/better-sqlite3') as typeof import('drizzle-orm/better-sqlite3');
	/* eslint-enable @typescript-eslint/no-require-imports */

	const sqlite = new Database(':memory:');

	for (const file of globSync('migrations/*/migration.sql').sort()) {
		for (const statement of readFileSync(file, 'utf8')
			.split('--> statement-breakpoint')
			.map((s: string) => s.trim())
			.filter(Boolean)) {
			sqlite.exec(statement);
		}
	}

	// After the replay, not before: a table rebuild toggles this pragma back on
	// as its last statement. Off for the same reason the sibling specs turn it
	// off — these are aggregate queries, and seeding every referenced parent
	// row would test nothing extra.
	sqlite.pragma('foreign_keys = OFF');

	// `drizzle({ client })`, not `drizzle(client)` — the positional overload is
	// gone in drizzle 1.0 and a raw Database is read as a config object, which
	// quietly opens a second, empty database.
	return { sqlite, testDb: drizzle({ client: sqlite }) };
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
vi.mock('$lib/server/volunteer/member-certification-service', () => ({
	missingRequirements: vi.fn(async () => [])
}));

const svc = await import('./volunteer-signup-service');
const { listShifts } = await import('./work-order-service');

const ROLE = 'role-1';
const SHIFT = 'shift-1';
const COORDINATOR = 'usr-coordinator';
const ADA = 'usr-ada';
const BO = 'usr-bo';
const CAM = 'usr-cam';

const inHours = (n: number) => new Date(Date.now() + n * 3_600_000);

async function seed(capacity = 1) {
	const { user } = await import('$lib/server/db/schema/authentication');
	const { volunteerRole, workOrder } = await import('$lib/server/db/schema/volunteer');

	await testDb.insert(user).values(
		[COORDINATOR, ADA, BO, CAM].map((id) => ({
			id,
			name: id,
			email: `${id}@example.com`,
			emailVerified: false
		})) as never
	);
	await testDb
		.insert(volunteerRole)
		.values({ id: ROLE, name: 'Front Desk', isActive: true } as never);
	await testDb.insert(workOrder).values({
		id: SHIFT,
		volunteerRoleId: ROLE,
		startsAt: inHours(48),
		endsAt: inHours(52),
		capacity,
		createdByUserId: COORDINATOR
	} as never);
}

async function claimedCount() {
	const [shift] = await listShifts({});
	return shift.claimed;
}

beforeEach(async () => {
	for (const t of ['volunteer_signup', 'work_order', 'volunteer_role', 'user']) {
		sqlite.exec(`delete from ${t}`);
	}
	await seed();
});

describe('an invitation holds no place', () => {
	it('leaves the shift reading as needing somebody', async () => {
		await svc.inviteToShift(SHIFT, ADA, COORDINATOR);
		expect(await claimedCount()).toBe(0);
	});

	/** The decision: you chase four people for two slots. */
	it('can be sent past capacity', async () => {
		await svc.inviteToShift(SHIFT, ADA, COORDINATOR);
		await svc.inviteToShift(SHIFT, BO, COORDINATOR);
		await svc.inviteToShift(SHIFT, CAM, COORDINATOR);

		expect(await claimedCount()).toBe(0);
		expect(await svc.listInvitationsForShift(SHIFT)).toHaveLength(3);
	});

	it('starts counting the moment it is accepted', async () => {
		const { signupId } = await svc.inviteToShift(SHIFT, ADA, COORDINATOR);
		await svc.acceptInvitation(signupId, ADA);
		expect(await claimedCount()).toBe(1);
	});

	it('still holds none after a refusal', async () => {
		const { signupId } = await svc.inviteToShift(SHIFT, ADA, COORDINATOR);
		await svc.declineInvitation(signupId, ADA);
		expect(await claimedCount()).toBe(0);
	});
});

describe('accepting', () => {
	it('lands claimed, not confirmed — booking is the coordinator’s act', async () => {
		const { signupId } = await svc.inviteToShift(SHIFT, ADA, COORDINATOR);
		const row = await svc.acceptInvitation(signupId, ADA);
		expect(row.status).toBe('claimed');
	});

	it('is scoped to the invitee, so a stray id is a 404 rather than a seat', async () => {
		const { signupId } = await svc.inviteToShift(SHIFT, ADA, COORDINATOR);
		await expect(svc.acceptInvitation(signupId, BO)).rejects.toBeInstanceOf(
			svc.SignupNotFoundError
		);
	});

	/** Four asked, one place: the first to answer takes it. */
	it('refuses once somebody else has filled the last place', async () => {
		const a = await svc.inviteToShift(SHIFT, ADA, COORDINATOR);
		const b = await svc.inviteToShift(SHIFT, BO, COORDINATOR);

		await svc.acceptInvitation(a.signupId, ADA);
		await expect(svc.acceptInvitation(b.signupId, BO)).rejects.toBeInstanceOf(svc.ShiftFullError);
	});

	it('cannot be done twice', async () => {
		const { signupId } = await svc.inviteToShift(SHIFT, ADA, COORDINATOR);
		await svc.acceptInvitation(signupId, ADA);
		await expect(svc.acceptInvitation(signupId, ADA)).rejects.toBeInstanceOf(
			svc.SignupNotFoundError
		);
	});
});

describe('declining', () => {
	it('keeps the row, so the same person is not chased twice by mistake', async () => {
		const { signupId } = await svc.inviteToShift(SHIFT, ADA, COORDINATOR);
		await svc.declineInvitation(signupId, ADA);

		const onShift = await svc.listInvitationsForShift(SHIFT);
		expect(onShift).toHaveLength(1);
		expect(onShift[0].status).toBe('declined');
	});

	it('drops the invitation off the member’s list', async () => {
		const { signupId } = await svc.inviteToShift(SHIFT, ADA, COORDINATOR);
		await svc.declineInvitation(signupId, ADA);
		expect(await svc.listInvitationsForUser(ADA)).toEqual([]);
	});

	/** Plans change; asking again is a real thing to want. */
	it('can be followed by a fresh invitation on the same row', async () => {
		const first = await svc.inviteToShift(SHIFT, ADA, COORDINATOR);
		await svc.declineInvitation(first.signupId, ADA);

		const second = await svc.inviteToShift(SHIFT, ADA, COORDINATOR);
		expect(second.signupId).toBe(first.signupId);
		expect(await svc.listInvitationsForUser(ADA)).toHaveLength(1);
	});

	/** The board still offers it — "not from you asking" and "never" differ. */
	it('does not stop them claiming it themselves afterwards', async () => {
		const { signupId } = await svc.inviteToShift(SHIFT, ADA, COORDINATOR);
		await svc.declineInvitation(signupId, ADA);

		const row = await svc.claimShift(SHIFT, ADA);
		expect(row.status).toBe('claimed');
		expect(await claimedCount()).toBe(1);
	});
});

describe('expiry, which is derived rather than stored', () => {
	it('drops off the member’s list once the shift has started', async () => {
		const { workOrder } = await import('$lib/server/db/schema/volunteer');
		const { eq } = await import('drizzle-orm');
		await svc.inviteToShift(SHIFT, ADA, COORDINATOR);

		await testDb
			.update(workOrder)
			.set({ startsAt: inHours(-2), endsAt: inHours(-1) })
			.where(eq(workOrder.id, SHIFT));

		expect(await svc.listInvitationsForUser(ADA)).toEqual([]);
	});

	it('drops off once somebody else has filled the shift', async () => {
		await svc.inviteToShift(SHIFT, ADA, COORDINATOR);
		await svc.claimShift(SHIFT, BO);

		// Ada's invitation is still a row — the chase happened — but there is
		// nothing left to answer, so it is not put in front of her.
		expect(await svc.listInvitationsForUser(ADA)).toEqual([]);
		expect(await svc.listInvitationsForShift(SHIFT)).toHaveLength(1);
	});

	it('is refused outright once the shift has been called off', async () => {
		const { workOrder } = await import('$lib/server/db/schema/volunteer');
		const { eq } = await import('drizzle-orm');
		await testDb.update(workOrder).set({ cancelledAt: new Date() }).where(eq(workOrder.id, SHIFT));

		await expect(svc.inviteToShift(SHIFT, ADA, COORDINATOR)).rejects.toBeInstanceOf(
			svc.ShiftClosedError
		);
	});
});

describe('inviting somebody already answered', () => {
	it('refuses when they already hold a place', async () => {
		await svc.claimShift(SHIFT, ADA);
		await expect(svc.inviteToShift(SHIFT, ADA, COORDINATOR)).rejects.toBeInstanceOf(
			svc.AlreadyOnShiftError
		);
	});

	it('refuses a second invitation while the first is unanswered', async () => {
		await svc.inviteToShift(SHIFT, ADA, COORDINATOR);
		await expect(svc.inviteToShift(SHIFT, ADA, COORDINATOR)).rejects.toBeInstanceOf(
			svc.AlreadyOnShiftError
		);
	});
});
