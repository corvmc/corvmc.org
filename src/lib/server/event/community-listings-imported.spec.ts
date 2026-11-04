import { describe, it, expect, beforeEach, vi } from 'vitest';

/** "My listings" against a real SQLite: the exclusion is a WHERE clause. */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const { listCommunityEventsForUser, listRejectedForUser } =
	await import('./community-event-service');

beforeEach(() => {
	sqlite.exec('delete from event_listing');
	const row = (id: string, status: string, importSource: string | null) =>
		`('${id}', 'Show', 1000, '${status}', 'community', 'staff-1', ${importSource ? `'${importSource}'` : 'null'})`;
	sqlite.exec(
		`insert into event_listing (id, title, starts_at, status, source, created_by_user_id, import_source_id) values
			${row('own', 'published', null)},
			${row('own-rejected', 'rejected', null)},
			${row('fed', 'published', 'src-1')},
			${row('fed-rejected', 'rejected', 'src-1')}`
	);
});

describe('a partner feed’s listings in the adding staffer’s own lists', () => {
	it('are left out of their listings', async () => {
		expect((await listCommunityEventsForUser('staff-1')).map((r) => r.id)).toEqual(['own']);
	});

	it('are left out of their turned-down listings', async () => {
		expect((await listRejectedForUser('staff-1')).map((r) => r.id)).toEqual(['own-rejected']);
	});
});
