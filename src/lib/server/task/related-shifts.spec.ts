import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A record's shifts (#2630), on a real SQLite: the same relations as its
 * tasks, joined to `volunteer_shift`, each shift once, with cancelled and
 * ended ones left out.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite, withBatch } = await import('#lib/server/testing/migrated-sqlite.js');
	const db = migratedSqlite();
	return { sqlite: db.sqlite, testDb: withBatch(db) };
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const { relatedShifts, relatedEndedShifts, relatedShiftTasks, isRelatedTask } =
	await import('./related-shifts');

const NOW = new Date('2026-06-15T12:00:00Z');
const at = (hours: number) => Math.floor(NOW.getTime() / 1000) + hours * 3600;

beforeEach(() => {
	for (const table of [
		'volunteer_signup',
		'volunteer_shift',
		'work_order',
		'project',
		'event_listing',
		'volunteer_role',
		'user'
	]) {
		sqlite.exec(`delete from ${table}`);
	}
	sqlite.exec(`
		insert into user (id, name, email) values ('u1', 'Ada', 'ada@example.com'), ('u2', 'Bo', 'bo@example.com');
		insert into volunteer_role (id, name) values ('door', 'Door'), ('bar', 'Bar');
		insert into project (id, name, kind, status) values ('show', 'Two-night show', 'production', 'in_progress');
		insert into event_listing (id, title, starts_at, ends_at, status, source, kind, created_by_user_id, project_id) values
			('fri', 'Friday', ${at(24)}, ${at(28)}, 'published', 'cmc', 'show', 'u1', 'show'),
			('sat', 'Saturday', ${at(48)}, ${at(52)}, 'published', 'cmc', 'show', 'u1', 'show');

		insert into work_order (id, volunteer_role_id, event_id, project_id) values
			('fri-door', 'door', 'fri', 'show'),
			('sat-door', 'door', 'sat', 'show'),
			('setup', 'bar', null, 'show'),
			('swept', 'bar', 'fri', null);
		insert into work_order (id, volunteer_role_id, event_id, cancelled_at) values
			('fri-off', 'door', 'fri', ${at(-1)});
		insert into work_order (id, title, event_id) values ('fri-note', 'Posters', 'fri');
		insert into work_order (id, volunteer_role_id) values ('elsewhere', 'door');

		insert into volunteer_shift (id, work_order_id, starts_at, ends_at, capacity) values
			('s-fri-door', 'fri-door', ${at(23)}, ${at(28)}, 2),
			('s-sat-door', 'sat-door', ${at(47)}, ${at(52)}, 1),
			('s-setup-a', 'setup', ${at(20)}, ${at(22)}, 3),
			('s-setup-b', 'setup', ${at(44)}, ${at(46)}, 3),
			('s-fri-off', 'fri-off', ${at(23)}, ${at(28)}, 1),
			('s-swept', 'swept', ${at(-5)}, ${at(-2)}, 1);
		insert into volunteer_shift (id, work_order_id, starts_at, ends_at, capacity, cancelled_at) values
			('s-fri-called-off', 'fri-door', ${at(30)}, ${at(32)}, 1, ${at(-1)});

		insert into volunteer_signup (id, shift_id, user_id, status) values
			('su1', 's-fri-door', 'u1', 'confirmed'),
			('su2', 's-fri-door', 'u2', 'claimed');
	`);
});

const shiftIds = (groups: Awaited<ReturnType<typeof relatedShifts>>) =>
	groups.map((g) => ({ key: g.key, ids: g.shifts.map((s) => s.shiftId).sort() }));

describe('relatedShifts', () => {
	it("lists one night's shifts under the event and the rest of the show under the show, each once", async () => {
		expect(shiftIds(await relatedShifts({ type: 'event', id: 'fri' }, { from: NOW }))).toEqual([
			{ key: 'event', ids: ['s-fri-door'] },
			{ key: 'show', ids: ['s-sat-door', 's-setup-a', 's-setup-b'] }
		]);
	});

	it('leaves out cancelled shifts, shifts on called-off tasks, and ended shifts', async () => {
		const all = (await relatedShifts({ type: 'event', id: 'fri' }, { from: NOW })).flatMap((g) =>
			g.shifts.map((s) => s.shiftId)
		);
		expect(all).not.toContain('s-fri-called-off');
		expect(all).not.toContain('s-fri-off');
		expect(all).not.toContain('s-swept');
	});

	it('reads ended shifts back in from an earlier instant', async () => {
		const [group] = await relatedShifts(
			{ type: 'event', id: 'fri' },
			{ from: new Date(NOW.getTime() - 6 * 3_600_000) }
		);
		expect(group.shifts.map((s) => s.shiftId)).toContain('s-swept');
	});

	it('carries the booked and claimed places Volunteering counts', async () => {
		const [group] = await relatedShifts({ type: 'event', id: 'fri' }, { from: NOW });
		expect(group.shifts[0]).toMatchObject({ capacity: 2, claimed: 2, confirmed: 1 });
	});

	it('limits each relation and says there is more', async () => {
		const [group] = await relatedShifts(
			{ type: 'project', id: 'show' },
			{ from: NOW, limitPerRelation: 2 }
		);
		expect(group.shifts).toHaveLength(2);
		expect(group.more).toBe(true);
	});

	it('returns nothing for a type with no resolver', async () => {
		expect(await relatedShifts({ type: 'member', id: 'u1' }, { from: NOW })).toEqual([]);
	});
});

describe('relatedEndedShifts', () => {
	it("lists the record's open tasks whose shifts are all over", async () => {
		const ended = await relatedEndedShifts({ type: 'event', id: 'fri' }, NOW);
		expect(ended.map((t) => t.id)).toEqual(['swept']);
		expect(await relatedEndedShifts({ type: 'role', id: 'door' }, NOW)).toEqual([]);
	});
});

describe('Add shift choices', () => {
	it("offers the record's open tasks that have a role", async () => {
		const ids = (await relatedShiftTasks({ type: 'event', id: 'fri' })).map((t) => t.id).sort();
		expect(ids).toEqual(['fri-door', 'sat-door', 'setup', 'swept']);
	});

	it("accepts only the record's own tasks", async () => {
		expect(await isRelatedTask({ type: 'event', id: 'sat' }, 'fri-door')).toBe(true);
		expect(await isRelatedTask({ type: 'event', id: 'sat' }, 'elsewhere')).toBe(false);
		expect(await isRelatedTask({ type: 'member', id: 'u1' }, 'fri-door')).toBe(false);
	});
});
