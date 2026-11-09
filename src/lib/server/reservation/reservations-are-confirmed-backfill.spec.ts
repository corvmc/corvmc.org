/**
 * The #2502 backfill: every `scheduled` reservation becomes `confirmed`, and no
 * other status moves. Real SQLite over the real migrations, then the backfill's
 * own SQL again against rows inserted afterwards.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { drizzle } from 'drizzle-orm/node-sqlite';
import { migrate } from 'drizzle-orm/node-sqlite/migrator';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsFolder = join(import.meta.dirname, '..', '..', '..', '..', 'migrations');
const backfillDir = readdirSync(migrationsFolder).find((d) =>
	d.endsWith('_reservations_are_confirmed')
)!;
const backfillSql = readFileSync(join(migrationsFolder, backfillDir, 'migration.sql'), 'utf8');

const client = new DatabaseSync(':memory:');
const statuses = ['scheduled', 'confirmed', 'completed', 'no_show', 'cancelled', 'waitlisted'];

beforeAll(() => {
	migrate(drizzle({ client }), { migrationsFolder });
	client.exec(
		`INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
		 VALUES ('member-1', 'Member', 'member-1@example.com', 0, unixepoch(), unixepoch())`
	);
	statuses.forEach((status, i) =>
		client
			.prepare(
				`INSERT INTO reservation (id, booker_type, booker_id, created_by_user_id, status,
				  starts_at, ends_at, created_at, updated_at)
				 VALUES (?, 'user', 'member-1', 'member-1', ?, ?, ?, 1, 1)`
			)
			.run(status, status, 1800000000 + i * 7200, 1800003600 + i * 7200)
	);
	client.exec(
		`INSERT INTO notification_preference (id, user_id, notification_type)
		 VALUES ('p1', 'member-1', 'confirmation_reminder'), ('p2', 'member-1', 'reservation_reminder')`
	);
	for (const statement of backfillSql.split('--> statement-breakpoint')) client.exec(statement);
});

afterAll(() => client.close());

const statusOf = (id: string) =>
	(client.prepare('SELECT status FROM reservation WHERE id = ?').get(id) as { status: string })
		.status;

describe('reservations are confirmed backfill', () => {
	it('confirms a scheduled reservation', () => {
		expect(statusOf('scheduled')).toBe('confirmed');
	});

	it('leaves every other status where it was', () => {
		for (const status of statuses.filter((s) => s !== 'scheduled')) {
			expect(statusOf(status)).toBe(status);
		}
	});

	it('drops preferences for the removed reminder and keeps the rest', () => {
		const types = client
			.prepare('SELECT notification_type AS t FROM notification_preference ORDER BY t')
			.all()
			.map((r) => (r as { t: string }).t);
		expect(types).toEqual(['reservation_reminder']);
	});
});
