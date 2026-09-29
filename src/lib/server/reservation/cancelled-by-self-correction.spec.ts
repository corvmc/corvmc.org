/**
 * The #1697 correction of `cancelled_by = 'staff'` rows whose canceller was the
 * booking's own side. Replays every migration into real SQLite, inserts rows
 * shaped like what the backfill and the pre-#1690 `cancel()` wrote, then runs
 * the correction's SQL again, because each rule is a `WHERE` clause.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { migratedSqlite } from '$lib/server/testing/migrated-sqlite';

const migrationsFolder = join(import.meta.dirname, '..', '..', '..', '..', 'migrations');
const correctionDir = readdirSync(migrationsFolder).find((d) =>
	d.endsWith('_reservation_cancelled_by_self_correction')
)!;
const correctionSql = readFileSync(join(migrationsFolder, correctionDir, 'migration.sql'), 'utf8');

const CANCELLED_AT = 1790300000;

const { sqlite } = migratedSqlite();

function runCorrection() {
	for (const statement of correctionSql.split('--> statement-breakpoint')) sqlite.exec(statement);
}

function insert(
	id: string,
	opts: {
		createdBy: string;
		cancelledBy: string | null;
		cancelledByUserId: string | null;
		reason: string | null;
		status?: string;
	}
) {
	sqlite
		.prepare(
			`INSERT INTO reservation (id, booker_type, booker_id, created_by_user_id, status,
			  cancellation_reason, cancelled_by, cancelled_by_user_id, cancelled_at,
			  starts_at, ends_at, created_at, updated_at)
			 VALUES (?, 'user', ?, ?, ?, ?, ?, ?, ?, 1800000000, 1800007200, ?, ?)`
		)
		.run(
			id,
			opts.createdBy,
			opts.createdBy,
			opts.status ?? 'cancelled',
			opts.reason,
			opts.cancelledBy,
			opts.cancelledByUserId,
			CANCELLED_AT,
			CANCELLED_AT,
			CANCELLED_AT
		);
}

function read(id: string) {
	return sqlite
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
	for (const id of ['member-1', 'leader-1', 'staff-1']) {
		sqlite.exec(
			`INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
			 VALUES ('${id}', '${id}', '${id}@example.com', 0, unixepoch(), unixepoch())`
		);
	}
	const staff = { cancelledBy: 'staff', cancelledByUserId: 'staff-1' };

	insert('session-cancelled', {
		createdBy: 'leader-1',
		cancelledBy: 'staff',
		cancelledByUserId: 'leader-1',
		reason: 'Session cancelled'
	});
	insert('session-released', {
		createdBy: 'leader-1',
		cancelledBy: 'staff',
		cancelledByUserId: null,
		reason: 'Session no longer holds the room'
	});
	insert('staff-own', { ...staff, createdBy: 'staff-1', reason: 'Double-booked' });
	insert('staff-own-no-reason', { ...staff, createdBy: 'staff-1', reason: null });
	insert('staff-other', { ...staff, createdBy: 'member-1', reason: 'Double-booked' });
	insert('event-cancelled-own', { ...staff, createdBy: 'staff-1', reason: 'Event cancelled' });
	insert('event-deleted-own', { ...staff, createdBy: 'staff-1', reason: 'Event deleted' });
	insert('band-deactivated', {
		createdBy: 'member-1',
		cancelledBy: 'staff',
		cancelledByUserId: null,
		reason: 'Band deactivated'
	});
	insert('system', {
		createdBy: 'member-1',
		cancelledBy: 'system',
		cancelledByUserId: null,
		reason: 'Waitlist expired'
	});
	insert('unattributed', {
		createdBy: 'member-1',
		cancelledBy: null,
		cancelledByUserId: null,
		reason: 'Session cancelled'
	});

	runCorrection();
});

afterAll(() => sqlite.close());

describe('reservation cancelled_by self-cancellation correction', () => {
	it("records a leader's session cancellation as the member side, keeping the leader", () => {
		expect(read('session-cancelled')).toEqual({
			cancelled_by: 'member',
			cancelled_by_user_id: 'leader-1',
			cancelled_at: CANCELLED_AT
		});
	});

	it('records a released session room as the member side even with nobody named', () => {
		expect(read('session-released')).toEqual({
			cancelled_by: 'member',
			cancelled_by_user_id: null,
			cancelled_at: CANCELLED_AT
		});
	});

	it.each(['staff-own', 'staff-own-no-reason'])(
		'records a staffer cancelling their own booking (%s) as the member side',
		(id) => {
			expect(read(id)).toEqual({
				cancelled_by: 'member',
				cancelled_by_user_id: 'staff-1',
				cancelled_at: CANCELLED_AT
			});
		}
	);

	it.each([
		['staff-other', 'staff'],
		['event-cancelled-own', 'staff'],
		['event-deleted-own', 'staff'],
		['band-deactivated', 'staff'],
		['system', 'system'],
		['unattributed', null]
	])('leaves %s as %s', (id, cancelledBy) => {
		expect(read(id).cancelled_by).toBe(cancelledBy);
	});

	it('changes nothing on a second run', () => {
		const ids = ['session-cancelled', 'staff-own', 'staff-other', 'event-cancelled-own'];
		const before = ids.map(read);
		runCorrection();
		expect(ids.map(read)).toEqual(before);
	});
});
