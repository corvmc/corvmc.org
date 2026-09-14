import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Room-use totals, against a real SQLite.
 *
 * The arithmetic is the point: hours come out of a `SUM` over a timestamp
 * difference, and the distinct-booker count concatenates a polymorphic key. A
 * mocked `db` returns whatever the test told it to and would prove neither.
 */

/**
 * The whole schema, replayed from the committed migrations.
 *
 * Not `ddlFor(table)` as three sibling specs use: that lifts the `CREATE TABLE`
 * out of the migration that last created it, and `event` was renamed to
 * `event_listing` after creation, so it finds nothing. Replaying every
 * migration is what a rename survives, and it is what `db:migrate:local` does.
 */
const { sqlite, testDb } = vi.hoisted(() => {
	/* eslint-disable @typescript-eslint/no-require-imports */
	const { readFileSync, globSync } = require('node:fs') as typeof import('node:fs');
	const Database = require('better-sqlite3') as typeof import('better-sqlite3');
	const { drizzle } =
		require('drizzle-orm/better-sqlite3') as typeof import('drizzle-orm/better-sqlite3');
	/* eslint-enable @typescript-eslint/no-require-imports */

	const sqlite = new Database(':memory:');

	for (const file of globSync('migrations/*/migration.sql').sort()) {
		for (const statement of readFileSync(file, 'utf8')
			.split('--> statement-breakpoint')
			.map((s: string) => s.trim())
			.filter(Boolean)) {
			sqlite.exec(statement);
		}
	}

	// After the replay, not before: a table rebuild toggles this pragma back on
	// as its last statement. Off for the same reason the sibling specs turn it
	// off — these are aggregate queries, and seeding every referenced parent
	// row would test nothing extra.
	sqlite.pragma('foreign_keys = OFF');

	// `drizzle({ client })`, not `drizzle(client)` — the positional overload is
	// gone in drizzle 1.0 and a raw Database is read as a config object, which
	// quietly opens a second, empty database.
	return { sqlite, testDb: drizzle({ client: sqlite }) };
});

vi.mock('$lib/server/db', () => ({ db: testDb }));

const { getRoomUseTotals } = await import('./reservation-report-service');

const YEAR = { from: '2026-01-01', to: '2026-12-31' };

let seq = 0;

/** One booking, `hours` long, starting at noon UTC on the given January day. */
async function booking(
	over: {
		day?: number;
		hours?: number;
		status?: string;
		bookerType?: string;
		bookerId?: string;
	} = {}
) {
	const { reservation } = await import('$lib/server/db/schema/reservation');
	const day = over.day ?? 15;
	const hours = over.hours ?? 2;
	const startsAt = new Date(Date.UTC(2026, 0, day, 20, 0, 0));
	await testDb.insert(reservation).values({
		id: `res-${++seq}`,
		bookerType: over.bookerType ?? 'user',
		bookerId: over.bookerId ?? 'usr-1',
		createdByUserId: 'usr-1',
		status: over.status ?? 'completed',
		startsAt,
		endsAt: new Date(startsAt.getTime() + hours * 3600_000)
	} as never);
}

beforeEach(() => {
	seq = 0;
	sqlite.exec('delete from reservation');
});

describe('getRoomUseTotals', () => {
	it('sums hours across bookings', async () => {
		await booking({ hours: 2 });
		await booking({ hours: 3 });
		expect((await getRoomUseTotals(YEAR)).hours).toBe(5);
	});

	it('keeps a half hour rather than truncating it away', async () => {
		// Two 90-minute bookings are three hours. Dividing each by 3600 inside
		// the sum would floor both to one and report two.
		await booking({ hours: 1.5 });
		await booking({ hours: 1.5 });
		expect((await getRoomUseTotals(YEAR)).hours).toBe(3);
	});

	it('leaves out a cancelled or waitlisted booking, which held nothing', async () => {
		await booking({ hours: 2 });
		await booking({ hours: 8, status: 'cancelled' });
		await booking({ hours: 8, status: 'waitlisted' });

		const totals = await getRoomUseTotals(YEAR);

		expect(totals.sessions).toBe(1);
		expect(totals.hours).toBe(2);
	});

	it('counts a no-show as time the room was held, and says how much', async () => {
		await booking({ hours: 2 });
		await booking({ hours: 2, status: 'no_show' });

		const totals = await getRoomUseTotals(YEAR);

		expect(totals.sessions).toBe(2);
		expect(totals.hours).toBe(4);
		expect(totals.noShows).toBe(1);
	});

	it('does not merge a band and a member that share an id', async () => {
		// The reason the distinct count concatenates the type: `booker_id` is
		// only unique within its own table.
		await booking({ bookerType: 'user', bookerId: 'shared' });
		await booking({ bookerType: 'band', bookerId: 'shared' });
		expect((await getRoomUseTotals(YEAR)).distinctBookers).toBe(2);
	});

	it('counts one booker once however often they book', async () => {
		await booking();
		await booking({ day: 16 });
		expect((await getRoomUseTotals(YEAR)).distinctBookers).toBe(1);
	});

	it('honours the range', async () => {
		await booking({ day: 15 });
		expect((await getRoomUseTotals({ from: '2026-02-01', to: '2026-02-28' })).sessions).toBe(0);
	});
});
