import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The two orientation reminders, over real SQLite: staff hear about an
 * orientation shift nobody has signed up for a day out (#2567), and a member
 * without the Practice space clearance gets the first-visit mail in place of the
 * reservation reminder, so one mail, not two (#2569).
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});
vi.mock('#lib/server/db/index.js', () => ({ db: testDb, getRowCount: () => 0 }));
const emit = vi.fn(async (_event: string, _payload: unknown) => undefined);
vi.mock('#lib/server/event-bus/event-bus.js', () => ({ domainEvents: { emit, on: vi.fn() } }));
vi.mock('#lib/server/site-config/site-config-service.js', () => ({
	config: vi.fn(
		async (key: string) =>
			({
				'org.addressStreet': '6775 SW Philomath Blvd',
				'org.addressCity': 'Corvallis',
				'volunteer.firstVisitNotes': 'Park in the back lot.'
			})[key] ?? ''
	)
}));
vi.mock('#lib/server/authorization.js', () => ({
	listUsersWithCapability: vi.fn(async () => [
		{ id: 'u-coord', name: 'Coord', email: 'coord@x.test' }
	])
}));
vi.mock('#lib/server/sentry.js', () => ({ captureException: vi.fn() }));

const { reminders } = await import('./registry');
const { drainReminders } = await import('./drain');

const HOUR = 3_600_000;
const NOW = new Date('2026-07-13T17:00:00Z');
const inHours = (h: number) => new Date(NOW.getTime() + h * HOUR);
const byKey = (key: string) => reminders.find((r) => r.key === key)!;
const secs = (d: Date) => Math.floor(d.getTime() / 1000);

function booking(id: string, userId: string, startsAt: Date, bookerType = 'user') {
	sqlite
		.prepare(
			`insert into reservation (id, booker_type, booker_id, created_by_user_id, status, starts_at, ends_at)
			 values (?, ?, ?, ?, 'confirmed', ?, ?)`
		)
		.run(id, bookerType, userId, userId, secs(startsAt), secs(startsAt) + 3600);
}

/** An orientation task on the booking, with one shift starting at `startsAt`. */
function orientation(id: string, reservationId: string, startsAt: Date) {
	sqlite
		.prepare(
			`insert into work_order (id, volunteer_role_id, is_orientation, anchor)
			 values (?, 'role-or', 1, 'start')`
		)
		.run(id);
	sqlite
		.prepare(`insert into work_order_link (id, work_order_id, reservation_id) values (?, ?, ?)`)
		.run(`${id}-l`, id, reservationId);
	sqlite
		.prepare(
			`insert into volunteer_shift (id, work_order_id, starts_at, ends_at, anchor)
			 values (?, ?, ?, ?, 'start')`
		)
		.run(`${id}-s`, id, secs(startsAt), secs(startsAt) + 1800);
}

function signUp(workOrderId: string, status: string) {
	sqlite
		.prepare(`insert into volunteer_signup (shift_id, user_id, status) values (?, 'u-vol', ?)`)
		.run(`${workOrderId}-s`, status);
}

function clear(userId: string) {
	sqlite
		.prepare(
			`insert into member_certification (user_id, certification_id, granted_at)
			 values (?, 'practice-space', ?)`
		)
		.run(userId, secs(NOW) - 86_400);
}

beforeEach(() => {
	emit.mockClear();
	sqlite.exec(
		`delete from reminder_sent; delete from volunteer_signup; delete from volunteer_shift;
		 delete from work_order_link;
		 delete from work_order; delete from reservation; delete from member_certification;
		 delete from volunteer_role; delete from group_member; delete from "group"; delete from user;`
	);
	sqlite.exec(
		`insert into user (id, name, email) values
			('u-new', 'Nia', 'nia@x.test'), ('u-old', 'Olu', 'olu@x.test'),
			('u-vol', 'Vic', 'vic@x.test'), ('u-coord', 'Coord', 'coord@x.test')`
	);
	sqlite.exec(`insert into volunteer_role (id, name) values ('role-or', 'Rehearsal Orientation')`);
});

describe('unclaimed orientation alert', () => {
	it('lists a live orientation shift within a day that nobody holds a place on', async () => {
		booking('r-1', 'u-new', inHours(20));
		orientation('wo-1', 'r-1', inHours(19.8));

		const due = await byKey('orientation_unclaimed').due(NOW);
		expect(due.map((d) => d.subjectId)).toEqual([`wo-1:${inHours(19.8).toISOString()}`]);
		expect(due[0]).toMatchObject({
			recipients: [{ userId: 'u-coord' }],
			item: { workOrderId: 'wo-1', memberName: 'Nia' }
		});
	});

	it('skips a claimed shift, one more than a day out, and a cancelled one', async () => {
		booking('r-1', 'u-new', inHours(20));
		orientation('wo-1', 'r-1', inHours(19.8));
		signUp('wo-1', 'claimed');
		booking('r-2', 'u-old', inHours(30));
		orientation('wo-2', 'r-2', inHours(29.8));
		booking('r-3', 'u-old', inHours(10));
		orientation('wo-3', 'r-3', inHours(9.8));
		sqlite.prepare(`update work_order set cancelled_at = ? where id = 'wo-3'`).run(secs(NOW));

		expect(await byKey('orientation_unclaimed').due(NOW)).toEqual([]);
	});

	it('still lists a shift whose only sign-up was cancelled', async () => {
		booking('r-1', 'u-new', inHours(20));
		orientation('wo-1', 'r-1', inHours(19.8));
		signUp('wo-1', 'cancelled');

		expect(await byKey('orientation_unclaimed').due(NOW)).toHaveLength(1);
	});

	// #2990: a committee's orientation is its seats' news before every coordinator's.
	it("goes to the owning committee's seats, not every coordinator", async () => {
		sqlite.exec(`
			insert into "group" (id, kind, name, slug, join_policy) values
				('welcome', 'committee', 'Welcome', 'welcome', 'invite_only');
			insert into group_member (id, group_id, user_id, role, status) values
				('m-vol', 'welcome', 'u-vol', 'member', 'active');
		`);
		booking('r-1', 'u-new', inHours(20));
		orientation('wo-1', 'r-1', inHours(19.8));
		sqlite.exec(`update work_order set group_id = 'welcome' where id = 'wo-1'`);

		const [due] = await byKey('orientation_unclaimed').due(NOW);
		expect(due.recipients.map((r) => r.userId)).toEqual(['u-vol']);
	});
});

describe('first-visit email', () => {
	it('owes an uncleared member the first visit, with the tour time, address and notes', async () => {
		booking('r-1', 'u-new', inHours(20));
		orientation('wo-1', 'r-1', inHours(19.8));

		const due = await byKey('first_visit').due(NOW);
		expect(due).toHaveLength(1);
		expect(due[0].payload).toMatchObject({
			reservationId: 'r-1',
			userId: 'u-new',
			address: '6775 SW Philomath Blvd, Corvallis',
			notes: 'Park in the back lot.'
		});
		expect((due[0].payload as { tourTime: string | null }).tourTime).not.toBeNull();
	});

	it('carries no tour time when the booking has no orientation shift', async () => {
		booking('r-1', 'u-new', inHours(20));
		const [due] = await byKey('first_visit').due(NOW);
		expect((due.payload as { tourTime: string | null }).tourTime).toBeNull();
	});

	it('leaves out cleared members and band bookings', async () => {
		clear('u-old');
		booking('r-1', 'u-old', inHours(20));
		booking('r-2', 'u-new', inHours(21), 'band');

		expect(await byKey('first_visit').due(NOW)).toEqual([]);
	});

	it('sends each booking one of the two mails, not both', async () => {
		clear('u-old');
		booking('r-new', 'u-new', inHours(20));
		booking('r-old', 'u-old', inHours(20));

		await drainReminders(NOW, [byKey('first_visit'), byKey('reservation_reminder')]);
		const sent = emit.mock.calls.map(([event, p]) => [
			event,
			(p as { reservationId: string }).reservationId
		]);
		expect(sent).toEqual([
			['reservation.first_visit_due', 'r-new'],
			['reservation.reminder_due', 'r-old']
		]);
	});

	it('sends no reservation reminder after the first visit, even once the member is cleared', async () => {
		booking('r-new', 'u-new', inHours(20));
		await drainReminders(NOW, [byKey('first_visit')]);
		clear('u-new');
		emit.mockClear();

		await drainReminders(new Date(NOW.getTime() + HOUR), [byKey('reservation_reminder')]);
		expect(emit).not.toHaveBeenCalled();
	});
});
