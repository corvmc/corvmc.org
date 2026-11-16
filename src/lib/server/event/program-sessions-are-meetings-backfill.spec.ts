/**
 * The #2607 backfill: a club's or committee's listing becomes a meeting, its
 * series prototype included; a band's gig, a CMC show and a kind someone set
 * on purpose do not move. Real SQLite over the real migrations.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { drizzle } from 'drizzle-orm/node-sqlite';
import { migrate } from 'drizzle-orm/node-sqlite/migrator';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsFolder = join(import.meta.dirname, '..', '..', '..', '..', 'migrations');
const backfillDir = readdirSync(migrationsFolder).find((d) =>
	d.endsWith('_program_sessions_are_meetings')
)!;
const backfillSql = readFileSync(join(migrationsFolder, backfillDir, 'migration.sql'), 'utf8');

const client = new DatabaseSync(':memory:');

beforeAll(() => {
	migrate(drizzle({ client }), { migrationsFolder });
	client.exec(
		`INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
		 VALUES ('member-1', 'Member', 'member-1@example.com', 0, unixepoch(), unixepoch());
		 INSERT INTO "group" (id, name, slug, kind) VALUES
			('band-1', 'The Velvets', 'the-velvets', 'band'),
			('club-1', 'Real Book Club', 'real-book', 'club'),
			('committee-1', 'Facilities', 'facilities', 'committee')`
	);
	const rows: [id: string, source: string, groupId: string | null, kind: string, status: string][] =
		[
			['club', 'group', 'club-1', 'show', 'published'],
			['club-cancelled', 'group', 'club-1', 'show', 'cancelled'],
			['club-prototype', 'group', 'club-1', 'show', 'draft'],
			['committee', 'group', 'committee-1', 'show', 'published'],
			['club-class', 'group', 'club-1', 'class', 'published'],
			['band', 'band', 'band-1', 'show', 'published'],
			['cmc', 'cmc', null, 'show', 'published']
		];
	rows.forEach(([id, source, groupId, kind, status], i) =>
		client
			.prepare(
				`INSERT INTO event_listing (id, title, source, group_id, kind, status, starts_at, ends_at,
				  created_by_user_id)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'member-1')`
			)
			.run(id, id, source, groupId, kind, status, 1800000000 + i * 7200, 1800003600 + i * 7200)
	);
	for (const statement of backfillSql.split('--> statement-breakpoint')) client.exec(statement);
});

afterAll(() => client.close());

const kindOf = (id: string) =>
	(client.prepare('SELECT kind FROM event_listing WHERE id = ?').get(id) as { kind: string }).kind;

describe('program sessions are meetings backfill', () => {
	it.each(['club', 'club-cancelled', 'club-prototype', 'committee'])('makes %s a meeting', (id) => {
		expect(kindOf(id)).toBe('meeting');
	});

	it.each([
		['club-class', 'class'],
		['band', 'show'],
		['cmc', 'show']
	])('leaves %s as %s', (id, kind) => {
		expect(kindOf(id)).toBe(kind);
	});
});
