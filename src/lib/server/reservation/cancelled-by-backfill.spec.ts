/**
 * The one-time backfill of `reservation.cancelled_by` for rows cancelled before
 * the column existed. Run on real SQLite over the real migrations, then the
 * backfill's own SQL again against rows inserted afterwards, because each rule
 * is a `WHERE` clause that only a database can evaluate.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { drizzle } from 'drizzle-orm/node-sqlite';
import { migrate } from 'drizzle-orm/node-sqlite/migrator';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsFolder = join(import.meta.dirname, '..', '..', '..', '..', 'migrations');
const backfillDir = readdirSync(migrationsFolder).find((d) =>
	d.endsWith('_reservation_cancelled_by_backfill')
)!;
const backfillSql = readFileSync(join(migrationsFolder, backfillDir, 'migration.sql'), 'utf8');

// Before and after #1519 started auditing staff cancellations.
const BEFORE_AUDIT = 1780000000;
const AFTER_AUDIT = 1790300000;

const client = new DatabaseSync(':memory:');

function runBackfill() {
	for (const statement of backfillSql.split('--> statement-breakpoint')) client.exec(statement);
}

function insertReservation(id: string, status: string, reason: string | null, updatedAt: number) {
	client
		.prepare(
			`INSERT INTO reservation (id, booker_type, booker_id, created_by_user_id, status,
			  cancellation_reason, starts_at, ends_at, created_at, updated_at)
			 VALUES (?, 'user', 'member-1', 'member-1', ?, ?, 1800000000, 1800007200, ?, ?)`
		)
		.run(id, status, reason, updatedAt, updatedAt);
}

function read(id: string) {
	return client
		.prepare(
			`SELECT cancelled_by, cancelled_by_user_id, cancelled_at FROM reservation WHERE id = ?`
		)
		.get(id) as {
		cancelled_by: string | null;
		cancelled_by_user_id: string | null;
		cancelled_at: number | null;
	};
}

beforeAll(() => {
	migrate(drizzle({ client }), { migrationsFolder });
	for (const [id, name] of [
		['member-1', 'Member'],
		['staff-1', 'Staffer']
	]) {
		client.exec(
			`INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
			 VALUES ('${id}', '${name}', '${id}@example.com', 0, unixepoch(), unixepoch())`
		);
	}

	insertReservation('audited', 'cancelled', 'Double-booked', BEFORE_AUDIT);
	client.exec(
		`INSERT INTO audit_log (id, action, actor_user_id, actor_name, actor_email, subject_type,
		  subject_id, subject_label, details, created_at)
		 VALUES ('a1', 'reservation.cancelled_by_staff', 'staff-1', 'Staffer', 's@example.com', 'user',
		  'member-1', 'Member', json_object('reservationId', 'audited'), 1789000000)`
	);
	insertReservation('unconfirmed', 'cancelled', 'Not confirmed before start', BEFORE_AUDIT);
	insertReservation('waitlist', 'cancelled', 'Waitlist expired', BEFORE_AUDIT);
	insertReservation('band-deleted', 'cancelled', 'Band deleted', BEFORE_AUDIT);
	insertReservation('event', 'cancelled', 'Event cancelled', BEFORE_AUDIT);
	insertReservation('recent-member', 'cancelled', 'Changed plans', AFTER_AUDIT);
	insertReservation('old-unknown', 'cancelled', 'Changed plans', BEFORE_AUDIT);
	insertReservation('live', 'scheduled', null, AFTER_AUDIT);

	runBackfill();
});

afterAll(() => client.close());

describe('reservation cancelled_by backfill', () => {
	it('takes staff, the staffer and the time from the audit entry', () => {
		expect(read('audited')).toEqual({
			cancelled_by: 'staff',
			cancelled_by_user_id: 'staff-1',
			cancelled_at: 1789000000
		});
	});

	it.each([
		['unconfirmed', 'system'],
		['waitlist', 'system'],
		['band-deleted', 'owner'],
		['event', 'staff']
	])('reads %s from its fixed reason as %s, naming nobody', (id, cancelledBy) => {
		expect(read(id)).toEqual({
			cancelled_by: cancelledBy,
			cancelled_by_user_id: null,
			cancelled_at: BEFORE_AUDIT
		});
	});

	it('reads an unaudited cancellation after the audit began as the member side', () => {
		expect(read('recent-member')).toMatchObject({
			cancelled_by: 'member',
			cancelled_by_user_id: null
		});
	});

	it('leaves an older one with no evidence unattributed, but dated', () => {
		expect(read('old-unknown')).toEqual({
			cancelled_by: null,
			cancelled_by_user_id: null,
			cancelled_at: BEFORE_AUDIT
		});
	});

	it('does not touch a reservation that is not cancelled', () => {
		expect(read('live')).toEqual({
			cancelled_by: null,
			cancelled_by_user_id: null,
			cancelled_at: null
		});
	});

	it('changes nothing on a second run', () => {
		const ids = ['audited', 'unconfirmed', 'recent-member', 'old-unknown', 'live'];
		const before = ids.map(read);
		runBackfill();
		expect(ids.map(read)).toEqual(before);
	});
});
