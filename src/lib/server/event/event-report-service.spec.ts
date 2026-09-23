import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The event counts, against a real SQLite.
 *
 * Aggregate SQL with three `WHERE` clauses stacked on it, which is exactly what
 * a mocked `db` cannot check: it agrees with any predicate, so a report that
 * counted drafts as held events would pass. The schema comes out of the
 * committed migrations for the reason `inventory/reports.spec.ts` sets out.
 */

/** The whole schema, replayed from the committed migrations. Why: #847. */
const { sqlite, testDb } = await vi.hoisted(async () => {
	// `await import`, not `require`: the helper is TypeScript, which Node's
	// require cannot load. An async hoisted factory still resolves before the
	// mock below is asked for a database.
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
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
		expect(totals.cmcByKind).toEqual({ show: 1, work_party: 1, meeting: 0, class: 0, market: 0 });
	});

	it('names every kind even when none happened, so a column never vanishes', async () => {
		const totals = await getEventTotals(YEAR);
		expect(Object.keys(totals.cmcByKind).sort()).toEqual([
			'class',
			'market',
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
