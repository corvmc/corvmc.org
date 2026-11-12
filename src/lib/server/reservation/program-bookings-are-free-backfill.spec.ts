/**
 * The #2616 backfill: a club's or committee's unpriced booking is settled at
 * nothing; a band's, a member's, a paid one and a cancelled one do not move.
 * Real SQLite over the real migrations, then the backfill's own SQL again
 * against rows inserted afterwards.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { drizzle } from 'drizzle-orm/node-sqlite';
import { migrate } from 'drizzle-orm/node-sqlite/migrator';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsFolder = join(import.meta.dirname, '..', '..', '..', '..', 'migrations');
const backfillDir = readdirSync(migrationsFolder).find((d) =>
	d.endsWith('_program_bookings_are_free')
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
	const rows: [id: string, type: string, booker: string, status: string, paidAt: number | null][] =
		[
			['club', 'group', 'club-1', 'confirmed', null],
			['club-done', 'group', 'club-1', 'completed', null],
			['committee', 'group', 'committee-1', 'confirmed', null],
			['club-cancelled', 'group', 'club-1', 'cancelled', null],
			['club-paid', 'group', 'club-1', 'confirmed', 1800000000],
			['band', 'group', 'band-1', 'confirmed', null],
			['member', 'user', 'member-1', 'confirmed', null]
		];
	rows.forEach(([id, type, booker, status, paidAt], i) =>
		client
			.prepare(
				`INSERT INTO reservation (id, booker_type, booker_id, created_by_user_id, status,
				  starts_at, ends_at, paid_at, created_at, updated_at)
				 VALUES (?, ?, ?, 'member-1', ?, ?, ?, ?, 1, 1)`
			)
			.run(id, type, booker, status, 1800000000 + i * 7200, 1800003600 + i * 7200, paidAt)
	);
	for (const statement of backfillSql.split('--> statement-breakpoint')) client.exec(statement);
});

afterAll(() => client.close());

const dueOf = (id: string) =>
	(
		client.prepare('SELECT cash_due_cents AS due FROM reservation WHERE id = ?').get(id) as {
			due: number | null;
		}
	).due;

describe('program bookings are free backfill', () => {
	it.each(['club', 'club-done', 'committee'])('settles %s at nothing', (id) => {
		expect(dueOf(id)).toBe(0);
	});

	it.each(['club-cancelled', 'club-paid', 'band', 'member'])('leaves %s unpriced', (id) => {
		expect(dueOf(id)).toBeNull();
	});
});
