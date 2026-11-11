import { describe, it, expect, vi, beforeAll } from 'vitest';

/**
 * The clock never closes an equipment report (#2518): a report resolves when its
 * task is marked done. Runs the completion sweep and every listener the app
 * registers, except notification delivery, against a real SQLite. The task
 * carries the retired "close the reports" setting switched on, the case the old
 * listener acted on.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite, withBatch } = await import('#lib/server/testing/migrated-sqlite.js');
	const db = migratedSqlite();
	return { sqlite: db.sqlite, testDb: withBatch(db) };
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));
// Delivery only: what it sends is not what this spec is about.
vi.mock('#lib/server/notification/notification-listeners.js', () => ({
	registerAllNotificationListeners: () => {}
}));

const { registerListeners } = await import('#lib/server/event-bus/register-listeners.js');
const { domainEvents } = await import('#lib/server/event-bus/event-bus.js');
const { completeFinishedShifts } =
	await import('#lib/server/volunteer/volunteer-signup-service.js');
const { resolveWorkOrder } = await import('#lib/server/volunteer/work-order-service.js');

const HOUR = 3600;
const now = Math.floor(Date.now() / 1000);

const reportStatus = () =>
	(
		sqlite.prepare(`select status from work_request where id = 'report'`).get() as {
			status: string;
		}
	).status;

beforeAll(async () => {
	sqlite.exec(`
		insert into "user" (id, name, email) values
			('staff', 'Staff', 'staff@example.com'), ('vol', 'Vol', 'vol@example.com');
		insert into volunteer_role (id, name) values ('repair', 'Repair');
		insert into work_order (id, volunteer_role_id, title, close_reports_on_completion)
			values ('task', 'repair', 'Re-cone the bass cab', 1);
		insert into volunteer_shift (id, work_order_id, starts_at, ends_at, capacity)
			values ('shift', 'task', ${now - 3 * HOUR}, ${now - HOUR}, 1);
		insert into volunteer_signup (id, shift_id, user_id, status, claimed_at, confirmed_at)
			values ('signup', 'shift', 'vol', 'confirmed', ${now - 5 * HOUR}, ${now - 5 * HOUR});
		insert into work_request (id, work_order_id, location, note, status, reported_by_user_id)
			values ('report', 'task', 'Main room', 'Buzzes at volume', 'pending', 'staff');
	`);
	await registerListeners();
});

describe('equipment reports close with their task', () => {
	it('stay open when the task’s shift ends', async () => {
		const completed = await completeFinishedShifts();
		expect(completed.map((c) => c.signupId)).toEqual(['signup']);
		// What the cron does with each completed sign-up.
		for (const row of completed) {
			await domainEvents.emit('volunteer.shift_completed', {
				...row,
				startsAt: row.startsAt.toISOString(),
				endsAt: row.endsAt.toISOString()
			});
		}
		expect(reportStatus()).toBe('pending');
	});

	it('resolve when the task is marked done', async () => {
		await resolveWorkOrder('task', { resolvedByUserId: 'staff' });
		expect(reportStatus()).toBe('resolved');
	});
});
