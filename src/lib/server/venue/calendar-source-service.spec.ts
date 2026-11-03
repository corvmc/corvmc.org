import { describe, it, expect, beforeEach, vi } from 'vitest';

/** Against a real SQLite with foreign keys on: removal leans on `ON DELETE SET NULL`. */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite({ foreignKeys: true });
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const { addSource, setSourcePaused, removeSource, listSourcesForVenue, CalendarSourceExistsError } =
	await import('./calendar-source-service');

beforeEach(() => {
	sqlite.exec('delete from event_listing; delete from calendar_source; delete from venue;');
	sqlite.exec('delete from user');
	sqlite.exec(
		`insert into user (id, name, email, email_verified, created_at, updated_at)
			values ('staff-1', 'Staff', 'staff@example.com', 1, 0, 0)`
	);
	sqlite.exec(`insert into venue (id, name, slug) values ('v-1', 'The Whiteside', 'whiteside')`);
});

const add = (url: string) => addSource({ venueId: 'v-1', url, createdByUserId: 'staff-1' });

describe('calendar sources', () => {
	it('stores a webcal address as https and refuses it twice', async () => {
		await add('webcal://whiteside.example/cal.ics');

		expect((await listSourcesForVenue('v-1')).map((s) => s.url)).toEqual([
			'https://whiteside.example/cal.ics'
		]);
		await expect(add('https://whiteside.example/cal.ics')).rejects.toBeInstanceOf(
			CalendarSourceExistsError
		);
	});

	it('pauses and resumes', async () => {
		const { id } = await add('https://whiteside.example/cal.ics');
		await setSourcePaused(id, true);
		expect((await listSourcesForVenue('v-1'))[0].paused).toBe(true);
		await setSourcePaused(id, false);
		expect((await listSourcesForVenue('v-1'))[0].paused).toBe(false);
	});

	it('removes the feed and keeps the listings it imported', async () => {
		const { id } = await add('https://whiteside.example/cal.ics');
		sqlite.exec(
			`insert into event_listing (id, title, starts_at, status, source, created_by_user_id, import_source_id, import_uid)
				values ('e-1', 'Show', 1000, 'published', 'community', 'staff-1', '${id}', 'uid-1')`
		);
		await removeSource(id);

		expect(await listSourcesForVenue('v-1')).toEqual([]);
		expect(
			sqlite.prepare(`select status, import_source_id from event_listing where id = 'e-1'`).get()
		).toEqual({ status: 'published', import_source_id: null });
	});
});
