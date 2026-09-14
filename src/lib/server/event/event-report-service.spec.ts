import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The event counts, against a real SQLite.
 *
 * Aggregate SQL with three `WHERE` clauses stacked on it, which is exactly what
 * a mocked `db` cannot check: it agrees with any predicate, so a report that
 * counted drafts as held events would pass. The schema comes out of the
 * committed migrations for the reason `inventory/reports.spec.ts` sets out.
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

const { getEventTotals } = await import('./event-report-service');

const JAN = new Date('2026-01-15T12:00:00Z');
const JAN_END = new Date('2026-01-15T15:00:00Z');
const DEC = new Date('2026-12-15T12:00:00Z');
const YEAR = { from: '2026-01-01', to: '2026-12-31' };

let seq = 0;

async function listing(over: Record<string, unknown> = {}) {
	const { eventListing } = await import('$lib/server/db/schema/event');
	await testDb.insert(eventListing).values({
		id: `evt-${++seq}`,
		title: 'A show',
		startsAt: JAN,
		// `event_cmc_needs_end` is a real CHECK: a CMC listing must say when it
		// ends, because the room hold is derived from it.
		endsAt: JAN_END,
		createdByUserId: 'usr-1',
		status: 'published',
		source: 'cmc',
		kind: 'show',
		...over
	} as never);
}

beforeEach(() => {
	seq = 0;
	sqlite.exec('delete from event_listing');
});

describe('getEventTotals', () => {
	it('counts only published CMC listings as held, by kind', async () => {
		await listing();
		await listing({ kind: 'work_party' });
		await listing({ status: 'draft' });
		await listing({ status: 'pending_review' });

		const totals = await getEventTotals(YEAR);

		expect(totals.cmcTotal).toBe(2);
		expect(totals.cmcByKind).toEqual({ show: 1, work_party: 1, meeting: 0, class: 0 });
	});

	it('names every kind even when none happened, so a column never vanishes', async () => {
		const totals = await getEventTotals(YEAR);
		expect(Object.keys(totals.cmcByKind).sort()).toEqual([
			'class',
			'meeting',
			'show',
			'work_party'
		]);
	});

	it('keeps what CMC did not author out of its own count', async () => {
		await listing({ source: 'band' });
		await listing({ source: 'community' });
		await listing({ source: 'group' });

		const totals = await getEventTotals(YEAR);

		expect(totals.cmcTotal).toBe(0);
		expect(totals.bandListings).toBe(1);
		// A club or committee session counts with the members' own programming.
		expect(totals.communityListings).toBe(2);
	});

	it('reports a cancelled show separately rather than as held', async () => {
		await listing({ status: 'cancelled' });

		const totals = await getEventTotals(YEAR);

		expect(totals.cmcTotal).toBe(0);
		expect(totals.cancelled).toBe(1);
	});

	it('excludes a listing outside the range', async () => {
		await listing({ startsAt: DEC, endsAt: new Date('2026-12-15T15:00:00Z') });
		expect((await getEventTotals({ from: '2026-01-01', to: '2026-01-31' })).cmcTotal).toBe(0);
		expect((await getEventTotals(YEAR)).cmcTotal).toBe(1);
	});
});
