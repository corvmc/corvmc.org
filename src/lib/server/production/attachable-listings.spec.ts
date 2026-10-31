import { describe, it, expect, beforeEach, vi } from 'vitest';

/** Which listings "New production" offers to attach to, against a real SQLite. */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

vi.mock('$lib/server/db', () => ({ db: testDb }));

const { listAttachableListings } = await import('./attachable-listings');

const NOW = new Date('2026-10-14T18:00:00Z');
const at = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

function listing(id: string, startsAt: string, over: Record<string, string> = {}) {
	const cols = {
		source: "'cmc'",
		kind: "'show'",
		status: "'draft'",
		project_id: 'null',
		...over
	};
	const s = at(startsAt);
	sqlite.exec(
		`insert into event_listing (id, title, starts_at, ends_at, created_by_user_id, source, kind, status, project_id)
		values ('${id}', 'Show ${id}', ${s}, ${s + 7200}, 'u', ${cols.source}, ${cols.kind}, ${cols.status}, ${cols.project_id})`
	);
}

beforeEach(() => {
	for (const t of ['event_listing', 'production', 'project', 'user'])
		sqlite.exec(`delete from ${t}`);
	sqlite.exec(
		`insert into user (id, name, email, email_verified) values ('u', 'Staff', 'u@x.test', 0)`
	);
	sqlite.exec(`insert into project (id, name, kind) values ('proj', 'Friday', 'production')`);
	sqlite.exec(`insert into production (id, project_id, status) values ('prod', 'proj', 'draft')`);
});

describe('listAttachableListings', () => {
	it('offers upcoming CMC shows with no production, soonest first', async () => {
		listing('later', '2026-11-01T03:00:00Z');
		listing('sooner', '2026-10-20T03:00:00Z', { status: "'published'" });

		const rows = await listAttachableListings(NOW);

		expect(rows.map((r) => r.id)).toEqual(['sooner', 'later']);
		expect(rows[0]).toEqual({
			id: 'sooner',
			title: 'Show sooner',
			startsAt: new Date('2026-10-20T03:00:00Z')
		});
	});

	it('leaves out a show that already has a production', async () => {
		listing('produced', '2026-10-20T03:00:00Z', { project_id: "'proj'" });
		expect(await listAttachableListings(NOW)).toEqual([]);
	});

	it('leaves out past, cancelled, non-show and non-CMC listings', async () => {
		listing('past', '2026-10-01T03:00:00Z');
		listing('cancelled', '2026-10-20T03:00:00Z', { status: "'cancelled'" });
		listing('meeting', '2026-10-20T03:00:00Z', { kind: "'meeting'" });
		listing('band', '2026-10-20T03:00:00Z', { source: "'band'" });

		expect(await listAttachableListings(NOW)).toEqual([]);
	});

	it('still offers a show that has started but not ended', async () => {
		listing('tonight', '2026-10-14T17:00:00Z');
		expect((await listAttachableListings(NOW)).map((r) => r.id)).toEqual(['tonight']);
	});
});
