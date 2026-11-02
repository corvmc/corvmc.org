import { describe, it, expect, beforeEach, vi } from 'vitest';
import whiteside from './partner-feed.fixtures/whiteside.ics?raw';

/** Upserts and dedupe against a real SQLite: the rules live in WHERE clauses. */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

// better-sqlite3's drizzle has no `batch`; D1's runs the statements in order, as this does.
vi.mock('$lib/server/db', () => ({
	db: Object.assign(testDb, {
		batch: async (stmts: PromiseLike<unknown>[]) => {
			const out = [];
			for (const s of stmts) out.push(await s);
			return out;
		}
	})
}));

const { runPartnerImports } = await import('./partner-import-service');

const NOW = new Date('2026-11-02T12:00:00Z');
const feed = (body: string, status = 200) => vi.fn(async () => new Response(body, { status }));

type Row = { title: string; status: string; import_uid: string | null; venue_id: string | null };
const listings = () =>
	sqlite
		.prepare('select title, status, import_uid, venue_id from event_listing order by starts_at')
		.all() as Row[];
const source = () =>
	sqlite
		.prepare('select last_error, last_imported_count, last_fetched_at from calendar_source')
		.get() as { last_error: string | null; last_imported_count: number | null };

beforeEach(() => {
	sqlite.exec('delete from event_listing; delete from calendar_source; delete from venue;');
	sqlite.exec('delete from user');
	sqlite.exec(
		`insert into user (id, name, email, email_verified, created_at, updated_at)
			values ('staff-1', 'Staff', 'staff@example.com', 1, 0, 0)`
	);
	sqlite.exec(
		`insert into venue (id, name, slug) values ('v-1', 'The Whiteside', 'the-whiteside')`
	);
	sqlite.exec(
		`insert into calendar_source (id, venue_id, url, created_by_user_id)
			values ('src-1', 'v-1', 'https://whiteside.example/cal.ics', 'staff-1')`
	);
});

describe('runPartnerImports', () => {
	it('publishes upcoming shows at the venue, skipping a cancelled one it never listed', async () => {
		const [result] = await runPartnerImports({ fetcher: feed(whiteside), now: NOW });

		expect(result).toMatchObject({ ok: true, inserted: 5, updated: 0, skipped: 1 });
		const rows = listings();
		expect(rows).toHaveLength(5);
		expect(rows.every((r) => r.status === 'published' && r.venue_id === 'v-1')).toBe(true);
		expect(rows.map((r) => r.import_uid)).not.toContain('show-2@whiteside.example');
		expect(source().last_imported_count).toBe(5);
		expect(source().last_error).toBeNull();
	});

	it('updates in place on a second run instead of adding rows', async () => {
		await runPartnerImports({ fetcher: feed(whiteside), now: NOW });
		const retitled = whiteside.replace('Paper Wolves\\, Low Tide', 'Paper Wolves');
		const [result] = await runPartnerImports({ fetcher: feed(retitled), now: NOW });

		expect(result).toMatchObject({ inserted: 0, updated: 5 });
		expect(listings()).toHaveLength(5);
		expect(listings().map((r) => r.title)).toContain('Paper Wolves');
	});

	it('cancels a listed show the feed later cancels', async () => {
		await runPartnerImports({ fetcher: feed(whiteside), now: NOW });
		const cancelled = whiteside.replace('STATUS:CONFIRMED', 'STATUS:CANCELLED');
		await runPartnerImports({ fetcher: feed(cancelled), now: NOW });

		const row = listings().find((r) => r.import_uid === 'show-1@whiteside.example');
		expect(row?.status).toBe('cancelled');
	});

	it('never puts back a listing staff pulled', async () => {
		await runPartnerImports({ fetcher: feed(whiteside), now: NOW });
		sqlite.exec(
			`update event_listing set status = 'rejected' where import_uid = 'show-1@whiteside.example'`
		);
		const [result] = await runPartnerImports({ fetcher: feed(whiteside), now: NOW });

		expect(result).toMatchObject({ updated: 4 });
		const row = listings().find((r) => r.import_uid === 'show-1@whiteside.example');
		expect(row?.status).toBe('rejected');
	});

	it('leaves a show alone when it disappears from the feed', async () => {
		await runPartnerImports({ fetcher: feed(whiteside), now: NOW });
		const emptied = whiteside.replace(/BEGIN:VEVENT[\s\S]*END:VEVENT\r?\n/, '');
		await runPartnerImports({ fetcher: feed(emptied), now: NOW });

		expect(listings()).toHaveLength(5);
		expect(listings().every((r) => r.status === 'published')).toBe(true);
	});

	it('does not add a show a member already listed at that venue that day', async () => {
		sqlite.exec(
			`insert into event_listing (id, title, starts_at, status, source, location, created_by_user_id)
				values ('member-1', 'Wolves!', ${Date.UTC(2026, 11, 6, 5) / 1000}, 'published',
					'community', 'the whiteside', 'staff-1')`
		);
		await runPartnerImports({ fetcher: feed(whiteside), now: NOW });

		expect(listings().map((r) => r.import_uid)).not.toContain('show-1@whiteside.example');
	});

	it('records a failed fetch on the source and keeps going', async () => {
		sqlite.exec(
			`insert into calendar_source (id, venue_id, url, created_by_user_id)
				values ('src-2', 'v-1', 'https://other.example/cal.ics', 'staff-1')`
		);
		const fetcher = vi.fn(async (url: string) =>
			url.includes('other') ? new Response('gone', { status: 404 }) : new Response(whiteside)
		);
		const results = await runPartnerImports({ fetcher, now: NOW });

		expect(results.find((r) => r.sourceId === 'src-2')).toMatchObject({ ok: false });
		expect(results.find((r) => r.sourceId === 'src-1')).toMatchObject({ ok: true, inserted: 5 });
		const failed = sqlite
			.prepare(`select last_error from calendar_source where id = 'src-2'`)
			.get() as { last_error: string };
		expect(failed.last_error).toBe('HTTP 404');
	});

	it('skips a paused source', async () => {
		sqlite.exec(`update calendar_source set paused = 1`);
		const fetcher = feed(whiteside);

		expect(await runPartnerImports({ fetcher, now: NOW })).toEqual([]);
		expect(fetcher).not.toHaveBeenCalled();
	});
});
