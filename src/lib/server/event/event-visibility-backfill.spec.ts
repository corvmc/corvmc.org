/**
 * The #2662 backfill: a club's meeting becomes members-only and a committee's
 * or band's meeting its group's; every other listing stays public. Real SQLite
 * over the real migrations, stopped before the backfill so it runs on rows
 * written the way production's were.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { migratedSqlite } from '#lib/server/testing/migrated-sqlite.js';
import { defaultVisibility } from '#lib/server/db/schema/event.js';

const migrationsFolder = join(import.meta.dirname, '..', '..', '..', '..', 'migrations');
const backfillSql = readFileSync(
	join(
		migrationsFolder,
		readdirSync(migrationsFolder).find((d) => d.endsWith('_event_visibility_backfill'))!,
		'migration.sql'
	),
	'utf8'
);

const { sqlite } = migratedSqlite({ through: 'event_visibility' });

const rows: [id: string, source: string, groupId: string | null, kind: string, status: string][] = [
	['club', 'group', 'club-1', 'meeting', 'published'],
	['club-cancelled', 'group', 'club-1', 'meeting', 'cancelled'],
	['club-prototype', 'group', 'club-1', 'meeting', 'draft'],
	['committee', 'group', 'committee-1', 'meeting', 'published'],
	['band-meeting', 'band', 'band-1', 'meeting', 'published'],
	['club-class', 'group', 'club-1', 'class', 'published'],
	['band', 'band', 'band-1', 'show', 'published'],
	['cmc', 'cmc', null, 'show', 'published'],
	['cmc-meeting', 'cmc', null, 'meeting', 'published']
];

beforeAll(() => {
	sqlite.exec(
		`INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
		 VALUES ('member-1', 'Member', 'member-1@example.com', 0, unixepoch(), unixepoch());
		 INSERT INTO "group" (id, name, slug, kind) VALUES
			('band-1', 'The Velvets', 'the-velvets', 'band'),
			('club-1', 'Real Book Club', 'real-book', 'club'),
			('committee-1', 'Facilities', 'facilities', 'committee')`
	);
	rows.forEach(([id, source, groupId, kind, status], i) =>
		sqlite
			.prepare(
				`INSERT INTO event_listing (id, title, source, group_id, kind, status, starts_at, ends_at,
				  created_by_user_id)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'member-1')`
			)
			.run(id, id, source, groupId, kind, status, 1800000000 + i * 7200, 1800003600 + i * 7200)
	);
	for (const statement of backfillSql.split('--> statement-breakpoint')) sqlite.exec(statement);
});

const visibilityOf = (id: string) =>
	(
		sqlite.prepare('SELECT visibility FROM event_listing WHERE id = ?').get(id) as {
			visibility: string;
		}
	).visibility;

const ownerKind = { 'club-1': 'club', 'committee-1': 'committee', 'band-1': 'band' } as const;

describe('event visibility backfill', () => {
	it.each([
		['club', 'members'],
		['club-cancelled', 'members'],
		['club-prototype', 'members'],
		['committee', 'group'],
		['band-meeting', 'group'],
		['club-class', 'public'],
		['band', 'public'],
		['cmc', 'public'],
		// No group owns it, so it is not a group-owned meeting.
		['cmc-meeting', 'public']
	])('sets %s to %s', (id, visibility) => {
		expect(visibilityOf(id)).toBe(visibility);
	});

	it('agrees with the default a new group-owned listing gets', () => {
		for (const [id, , groupId, kind] of rows) {
			if (!groupId) continue;
			const expected = defaultVisibility(
				kind as Parameters<typeof defaultVisibility>[0],
				ownerKind[groupId as keyof typeof ownerKind]
			);
			expect(visibilityOf(id), id).toBe(expected);
		}
	});
});
