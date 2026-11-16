import { describe, it, expect, beforeEach, vi } from 'vitest';

/** An attached event's ref is built from SQL columns, so it runs against a real SQLite. */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));
vi.mock('#lib/server/volunteer/hour-value.js', () => ({ getHourValueCents: vi.fn(async () => 0) }));

const { listProjectAttachments } = await import('./project-service');

beforeEach(() => {
	sqlite.exec('delete from volunteer_signup');
	sqlite.exec('delete from volunteer_shift');
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

describe('attached events', () => {
	it('carry a ref for the entity card', async () => {
		const [ev] = (await listProjectAttachments('proj-1')).events;
		expect(ev.ref).toMatchObject({ type: 'event', id: 'ev-1', title: 'Spring Showcase' });
	});
});
