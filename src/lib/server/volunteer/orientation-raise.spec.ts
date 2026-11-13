import { describe, it, expect, vi, beforeEach } from 'vitest';

// `raiseOrientationShift` against a real SQLite (#2695): two raises for one
// booking that both read nothing leave one live orientation between them.

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite, withBatch } = await import('#lib/server/testing/migrated-sqlite.js');
	const handle = migratedSqlite({ foreignKeys: true });
	return { sqlite: handle.sqlite, testDb: withBatch(handle) };
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const settings: Record<string, unknown> = {
	'volunteer.orientationRoleId': 'role-door',
	'volunteer.orientationMinutes': 30,
	'volunteer.orientationLeadMinutes': 15,
	'volunteer.orientationTasks': 'Show the PA\nShow the exits',
	'volunteer.firstVisitNotes': ''
};
vi.mock('#lib/server/site-config/site-config-service.js', () => ({
	config: async (key: string) => settings[key]
}));

const { raiseOrientationShift } = await import('./orientation-service');

const STARTS = new Date('2026-12-01T18:00:00Z');

const table = (name: string) => sqlite.prepare(`select * from ${name}`).all();

beforeEach(() => {
	// On for the cascade from a deleted task; off while the fixture is cleared.
	sqlite.pragma('foreign_keys = OFF');
	for (const t of [
		'work_task',
		'work_order_link',
		'volunteer_shift',
		'work_order',
		'volunteer_role',
		'reservation',
		'user'
	]) {
		sqlite.exec(`delete from ${t}`);
	}
	sqlite.exec(`insert into user (id, name, email) values ('u-1', 'Ada', 'ada@example.com')`);
	sqlite
		.prepare(
			`insert into reservation (id, booker_type, booker_id, created_by_user_id, status, starts_at, ends_at)
			 values ('res-1', 'user', 'u-1', 'u-1', 'confirmed', ?, ?)`
		)
		.run(STARTS.getTime() / 1000, STARTS.getTime() / 1000 + 7200);
	sqlite.exec(`insert into volunteer_role (id, name) values ('role-door', 'Door')`);
	sqlite.pragma('foreign_keys = ON');
});

describe('raiseOrientationShift', () => {
	it('leaves one orientation when two raises for a booking overlap', async () => {
		const raised = await Promise.all([
			raiseOrientationShift('res-1', STARTS),
			raiseOrientationShift('res-1', STARTS)
		]);

		const orders = table('work_order') as { id: string }[];
		expect(orders).toHaveLength(1);
		expect(raised.map((r) => r?.id)).toEqual([orders[0].id, orders[0].id]);
		// The loser's shift, link and checklist went with its task.
		expect(table('volunteer_shift')).toHaveLength(1);
		expect(table('work_order_link')).toHaveLength(1);
		expect(table('work_task')).toHaveLength(2);
	});

	it('returns the live one already on the booking', async () => {
		const first = await raiseOrientationShift('res-1', STARTS);

		await expect(raiseOrientationShift('res-1', STARTS)).resolves.toEqual(first);
		expect(table('work_order')).toHaveLength(1);
	});
});
