import { describe, it, expect, vi, beforeEach } from 'vitest';

// `openHostShift` against a real SQLite (#2681): two producers opening the
// host shift at once get one work order, held by `work_order_event_host_idx`.

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const { openHostShift, getHostShift } = await import('./host-service');
const { HOST_VOLUNTEER_ROLE } = await import('#lib/config.js');

const hostOrders = () =>
	sqlite.prepare(`select id from work_order where event_id = 'ev1' and is_host = 1`).all() as {
		id: string;
	}[];

beforeEach(() => {
	for (const t of ['volunteer_shift', 'work_order', 'volunteer_role', 'event_listing', 'user']) {
		sqlite.exec(`delete from ${t}`);
	}
	sqlite.exec(
		`insert into user (id, name, email) values ('staff-1', 'Staff', 'staff@example.com')`
	);
	sqlite.exec(`insert into event_listing (id, title, starts_at, ends_at, status, source, kind, created_by_user_id)
		values ('ev1', 'Show', 1750000000, 1750010000, 'published', 'cmc', 'show', 'staff-1')`);
	sqlite
		.prepare(`insert into volunteer_role (id, name) values ('role-host', ?)`)
		.run(HOST_VOLUNTEER_ROLE);
});

describe('openHostShift', () => {
	it('opens one host work order when two producers press it at once', async () => {
		const ids = await Promise.all([openHostShift('ev1'), openHostShift('ev1')]);

		const orders = hostOrders();
		expect(orders).toHaveLength(1);
		expect(ids).toEqual([orders[0].id, orders[0].id]);
		expect((await getHostShift('ev1'))?.workOrderId).toBe(orders[0].id);
	});

	it('returns the one already open', async () => {
		const first = await openHostShift('ev1');

		await expect(openHostShift('ev1')).resolves.toBe(first);
		expect(hostOrders()).toHaveLength(1);
	});

	it('refuses a second host work order for the event at the schema', () => {
		const insert = sqlite.prepare(
			`insert into work_order (id, title, event_id, volunteer_role_id, is_host) values (?, 'Host', 'ev1', 'role-host', 1)`
		);
		insert.run('wo-a');

		expect(() => insert.run('wo-b')).toThrow(/UNIQUE/);
	});
});
