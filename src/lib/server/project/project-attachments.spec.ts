import { describe, it, expect, beforeEach, vi } from 'vitest';

/** A work order's title is resolved in SQL, so it is checked against a real SQLite. */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

vi.mock('$lib/server/db', () => ({ db: testDb }));
vi.mock('$lib/server/volunteer/hour-value', () => ({ getHourValueCents: vi.fn(async () => 0) }));

const { listProjectAttachments } = await import('./project-service');

beforeEach(() => {
	sqlite.exec('delete from volunteer_signup');
	sqlite.exec('delete from work_order');
	sqlite.exec('delete from event_listing');
	sqlite.exec('delete from volunteer_role');
	sqlite.exec('delete from project');
	sqlite.exec(`insert into project (id, name) values ('proj-1', 'Spring show')`);
	sqlite.exec(`insert into volunteer_role (id, name) values ('role-door', 'Door')`);
	sqlite.exec(
		`insert into event_listing (id, title, starts_at, ends_at, created_by_user_id, project_id)
			values ('ev-1', 'Spring Showcase', 1000, 2000, 'user-1', 'proj-1')`
	);
});

const titles = async () =>
	(await listProjectAttachments('proj-1')).workOrders.map((wo) => [wo.id, wo.title]);

describe('attached work-order titles', () => {
	it("uses the work order's own title first", async () => {
		sqlite.exec(
			`insert into work_order (id, volunteer_role_id, project_id, event_id, title, notes)
				values ('wo-1', 'role-door', 'proj-1', 'ev-1', 'Hang posters', 'bring tape')`
		);
		expect(await titles()).toEqual([['wo-1', 'Hang posters']]);
	});

	it("falls back to the event's title, then the role's name — never a placeholder", async () => {
		sqlite.exec(
			`insert into work_order (id, volunteer_role_id, project_id, event_id)
				values ('wo-ev', 'role-door', 'proj-1', 'ev-1')`
		);
		sqlite.exec(
			`insert into work_order (id, volunteer_role_id, project_id)
				values ('wo-role', 'role-door', 'proj-1')`
		);
		expect(Object.fromEntries(await titles())).toEqual({
			'wo-ev': 'Spring Showcase',
			'wo-role': 'Door'
		});
	});

	it('counts the places taken, not cancelled claims', async () => {
		sqlite.exec(
			`insert into work_order (id, volunteer_role_id, project_id, capacity)
				values ('wo-1', 'role-door', 'proj-1', 3)`
		);
		sqlite.exec(
			`insert into volunteer_signup (id, shift_id, user_id, status) values
				('s1', 'wo-1', 'u1', 'claimed'),
				('s2', 'wo-1', 'u2', 'confirmed'),
				('s3', 'wo-1', 'u3', 'cancelled')`
		);
		const [wo] = (await listProjectAttachments('proj-1')).workOrders;
		expect(wo.claimed).toBe(2);
	});
});

describe('attached events', () => {
	it('carry a ref for the entity card', async () => {
		const [ev] = (await listProjectAttachments('proj-1')).events;
		expect(ev.ref).toMatchObject({ type: 'event', id: 'ev-1', title: 'Spring Showcase' });
	});
});
