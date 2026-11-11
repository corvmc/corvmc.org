import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * A cancelled show's shifts, against a real SQLite (#1705).
 *
 * Every property here is a `WHERE` clause — which work orders count as live,
 * which claimants are told, which rows the board and the reminder sweep read —
 * so a mocked `db` would agree with any of them.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite, withBatch } = await import('#lib/server/testing/migrated-sqlite.js');
	const db = migratedSqlite();
	return { sqlite: db.sqlite, testDb: withBatch(db) };
});

vi.mock('#lib/server/db/index.js', () => ({
	db: testDb,
	getRowCount: (result: unknown) => (result as { changes?: number })?.changes ?? 0
}));

const emit = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock('#lib/server/event-bus/event-bus.js', () => ({ domainEvents: { emit } }));
vi.mock('#lib/server/sentry.js', () => ({ captureException: vi.fn() }));

const { cancelShiftsForEvent, cancelShiftsForProduction, cancelDeliverablesForEvent } =
	await import('./show-cancellation');
const { listOpenShiftsForMember, getWorkOrderById } = await import('./work-order-service');
const { listSignupsStartingBetween } = await import('./volunteer-signup-service');

const STAFF = 'usr-staff';
const ADA = 'usr-ada';
const BO = 'usr-bo';
const ROLE = 'role-1';
const SHOW = 'evt-show';
const OTHER = 'evt-other';
const PROD = 'prod-1';

const inHours = (n: number) => new Date(Date.now() + n * 3_600_000);

async function seed() {
	const { user } = await import('#lib/server/db/schema/authentication.js');
	const { eventListing } = await import('#lib/server/db/schema/event.js');
	const { production } = await import('#lib/server/db/schema/production.js');
	const { volunteerRole, volunteerShift, workOrder, volunteerSignup } =
		await import('#lib/server/db/schema/volunteer.js');

	await testDb.insert(user).values(
		[STAFF, ADA, BO].map((id) => ({
			id,
			name: id,
			email: `${id}@example.com`,
			emailVerified: false
		})) as never
	);
	const { project } = await import('#lib/server/db/schema/project.js');
	await testDb.insert(project).values({ id: 'proj-show', name: 'A show', kind: 'production' });
	await testDb
		.insert(production)
		.values({ id: PROD, status: 'confirmed', projectId: 'proj-show' } as never);
	await testDb.insert(eventListing).values(
		[
			{ id: SHOW, projectId: 'proj-show' },
			{ id: OTHER, projectId: null }
		].map((e) => ({
			...e,
			title: e.id,
			startsAt: inHours(48),
			endsAt: inHours(52),
			createdByUserId: STAFF,
			status: 'published'
		})) as never
	);
	await testDb.insert(volunteerRole).values({ id: ROLE, name: 'Door', isActive: true } as never);

	// A task per crew job, and a shift on each that has a time (#2518).
	const task = (id: string, eventId: string, extra: Record<string, unknown> = {}) => ({
		id,
		volunteerRoleId: ROLE,
		eventId,
		createdByUserId: STAFF,
		...extra
	});
	await testDb
		.insert(workOrder)
		.values([
			task('door', SHOW),
			task('bar', SHOW),
			task('unscheduled', SHOW),
			task('load-in-done', SHOW, { resolvedAt: inHours(-1) }),
			task('last-week', SHOW),
			task('other-door', OTHER)
		] as never);
	const shift = (taskId: string, startsAt = inHours(47), endsAt = inHours(53)) => ({
		id: `${taskId}-shift`,
		workOrderId: taskId,
		startsAt,
		endsAt,
		capacity: 3,
		createdByUserId: STAFF
	});
	await testDb
		.insert(volunteerShift)
		.values([
			shift('door'),
			shift('bar'),
			shift('load-in-done'),
			shift('last-week', inHours(-170), inHours(-166)),
			shift('other-door')
		] as never);

	await testDb.insert(volunteerSignup).values([
		{ id: 'su-ada', shiftId: 'door-shift', userId: ADA, status: 'confirmed' },
		{ id: 'su-bo', shiftId: 'door-shift', userId: BO, status: 'claimed' },
		{ id: 'su-bo-dropped', shiftId: 'bar-shift', userId: BO, status: 'cancelled' },
		{ id: 'su-other', shiftId: 'other-door-shift', userId: ADA, status: 'confirmed' }
	] as never);
}

beforeEach(async () => {
	emit.mockClear();
	for (const t of [
		'volunteer_signup',
		'volunteer_shift',
		'work_order',
		'volunteer_role',
		'event_listing'
	]) {
		sqlite.exec(`delete from ${t}`);
	}
	sqlite.exec('delete from production');
	sqlite.exec('delete from project');
	sqlite.exec('delete from user');
	await seed();
});

/** The emits are fire-and-forget; let them run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const cancelled = async (id: string) => (await getWorkOrderById(id))?.cancelledAt ?? null;

describe('cancelling a show', () => {
	it('calls off every live work order on it, naming who did', async () => {
		expect(await cancelShiftsForEvent(SHOW, STAFF)).toBe(3);

		for (const id of ['door', 'bar', 'unscheduled']) {
			const row = await getWorkOrderById(id);
			expect(row?.cancelledAt).not.toBeNull();
			expect(row?.cancelledByUserId).toBe(STAFF);
		}
	});

	it('calls off the shifts on that work with it', async () => {
		await cancelShiftsForEvent(SHOW, STAFF);
		const live = sqlite
			.prepare(`select id from volunteer_shift where cancelled_at is null order by id`)
			.all()
			.map((r) => (r as { id: string }).id);
		expect(live).toEqual(['last-week-shift', 'load-in-done-shift', 'other-door-shift']);
	});

	it('leaves finished and past work, and other shows, alone', async () => {
		await cancelShiftsForEvent(SHOW, STAFF);

		expect(await cancelled('load-in-done')).toBeNull();
		expect(await cancelled('last-week')).toBeNull();
		expect(await cancelled('other-door')).toBeNull();
	});

	it('tells each live claimant, and nobody who had already dropped out', async () => {
		await cancelShiftsForEvent(SHOW, STAFF);
		await flush();

		const told = emit.mock.calls
			.filter(([name]) => name === 'volunteer.shift_cancelled')
			.map(([, data]) => (data as { signupId: string }).signupId)
			.sort();
		expect(told).toEqual(['su-ada', 'su-bo']);

		const notified = sqlite
			.prepare(`select id from volunteer_signup where notified_at is not null order by id`)
			.all()
			.map((r) => (r as { id: string }).id);
		expect(notified).toEqual(['su-ada', 'su-bo']);
	});

	it('does nothing the second time', async () => {
		await cancelShiftsForEvent(SHOW, STAFF);
		await flush();
		emit.mockClear();

		expect(await cancelShiftsForEvent(SHOW, STAFF)).toBe(0);
		await flush();
		expect(emit).not.toHaveBeenCalled();
	});

	it('reaches the show through its production', async () => {
		expect(await cancelShiftsForProduction(PROD, STAFF)).toBe(3);
		expect(await cancelled('door')).not.toBeNull();
		expect(await cancelled('other-door')).toBeNull();
	});
});

describe("a committee's items on the show (#1709)", () => {
	beforeEach(() => {
		sqlite.exec(
			`insert into "group" (id, name, slug, kind) values ('g', 'Art', 'art', 'committee')`
		);
		sqlite.exec(`insert into work_order (id, volunteer_role_id, event_id, group_id)
			values ('poster', '${ROLE}', '${SHOW}', 'g')`);
	});
	afterEach(() => {
		sqlite.exec(`delete from work_order where id = 'poster'`);
		sqlite.exec(`delete from "group"`);
	});

	it('are left to the cancellation notice, which tells the committee', async () => {
		expect(await cancelShiftsForEvent(SHOW, STAFF)).toBe(3);
		expect(await cancelled('poster')).toBeNull();
	});

	it('are called off quietly when the show is deleted outright', async () => {
		await cancelDeliverablesForEvent(SHOW, STAFF);
		expect((await getWorkOrderById('poster'))?.cancelledByUserId).toBe(STAFF);
		expect(await cancelled('door')).toBeNull();
	});
});

describe('after a show is cancelled', () => {
	it('sends no reminder for its shifts', async () => {
		await cancelShiftsForEvent(SHOW, STAFF);

		const due = await listSignupsStartingBetween(inHours(0), inHours(72));
		expect(due.map((d) => d.signupId)).toEqual(['su-other']);
	});

	// A listing cancelled before the cascade existed still has live work orders.
	it('keeps its shifts off the member board even if a work order was left live', async () => {
		sqlite.exec(`update event_listing set status = 'cancelled' where id = '${SHOW}'`);

		const board = await listOpenShiftsForMember(ADA);
		expect(board.map((s) => s.workOrderId)).toEqual(['other-door']);
	});

	it('sends no reminder for a live work order on a cancelled listing', async () => {
		sqlite.exec(`update event_listing set status = 'cancelled' where id = '${SHOW}'`);

		const due = await listSignupsStartingBetween(inHours(0), inHours(72));
		expect(due.map((d) => d.signupId)).toEqual(['su-other']);
	});
});
