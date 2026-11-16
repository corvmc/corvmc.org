import { describe, it, expect, beforeEach, vi } from 'vitest';
import { forEachClockEdge, addCalendarDays } from '#lib/test/clock-edges.js';

/**
 * The staff Events list against a real SQLite: the date presets, their order,
 * the filters and the status counts are all `WHERE`s a mocked `db` would agree with.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const { listStaffCalendar } = await import('./staff-calendar');
const { eventListing } = await import('#lib/server/db/schema/event.js');
const { buildDateInTz } = await import('#lib/server/reservation/timezone.js');
const { DEFAULT_TIMEZONE } = await import('#lib/config.js');

const HOUR = 3_600_000;
// Noon in Corvallis, so no preset boundary sits within a few hours of it.
const now = new Date('2026-06-15T19:00:00Z');
const at = (hours: number) => new Date(now.getTime() + hours * HOUR);
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

type Row = typeof eventListing.$inferInsert;
const listing = (id: string, startsAt: Date, extra: Partial<Row> = {}): Row => ({
	id,
	title: `Show ${id}`,
	startsAt,
	endsAt: new Date(startsAt.getTime() + 2 * HOUR),
	status: 'published',
	source: 'cmc',
	createdByUserId: 'user-1',
	...extra
});
const row = (id: string, startHours: number, extra: Partial<Row> = {}) =>
	listing(id, at(startHours), extra);

beforeEach(async () => {
	sqlite.exec('delete from event_listing');
	sqlite.exec('delete from venue');
	sqlite.exec('delete from "group"');
	sqlite.exec(
		`insert into "group" (id, kind, name, slug) values ('band-1', 'band', 'The Paper Wolves', 'paper-wolves')`
	);
	sqlite.exec(
		`insert into venue (id, name, slug) values ('venue-1', 'Whiteside Theatre', 'whiteside')`
	);
	await testDb.insert(eventListing).values([
		row('long-ago', -24 * 60),
		row('last-week', -24 * 5, { source: 'band', groupId: 'band-1' }),
		// Earlier today: started, but still today's.
		row('this-morning', -3, { status: 'pending_review', source: 'community' }),
		row('tonight', 6, { venueId: 'venue-1' }),
		row('next-week', 24 * 5, { status: 'cancelled' }),
		row('far', 24 * 20, { status: 'pending_review', source: 'community' }),
		row('private-draft', 24, { status: 'draft', source: 'community' })
	]);
});

describe('date presets', () => {
	const list = async (range: 'from_today' | 'next_7' | 'past_30' | 'any') =>
		ids((await listStaffCalendar({ range }, now)).rows);

	it('From today is the default: today and later by club day, soonest first', async () => {
		const rows = ids((await listStaffCalendar({}, now)).rows);
		expect(rows).toEqual(['this-morning', 'tonight', 'next-week', 'far']);
		expect(await list('from_today')).toEqual(rows);
	});

	it('Next 7 days stops a week out, soonest first', async () => {
		expect(await list('next_7')).toEqual(['this-morning', 'tonight', 'next-week']);
	});

	it('Past 30 days lists what has started, newest first', async () => {
		expect(await list('past_30')).toEqual(['this-morning', 'last-week']);
	});

	it('Any date lists everything staff may see, soonest first', async () => {
		expect(await list('any')).toEqual([
			'long-ago',
			'last-week',
			'this-morning',
			'tonight',
			'next-week',
			'far'
		]);
	});

	it('a custom range includes both end days, soonest first', async () => {
		const rows = await listStaffCalendar(
			{ range: 'custom', from: '2026-06-10', to: '2026-06-15' },
			now
		);
		expect(ids(rows.rows)).toEqual(['last-week', 'this-morning', 'tonight']);
	});
});

describe('filters', () => {
	it('narrows by source', async () => {
		expect(ids((await listStaffCalendar({ range: 'any', source: 'band' }, now)).rows)).toEqual([
			'last-week'
		]);
	});

	it('searches the title, the band and the venue', async () => {
		const search = async (q: string) =>
			ids((await listStaffCalendar({ range: 'any', q }, now)).rows);
		expect(await search('far')).toEqual(['far']);
		expect(await search('paper wolves')).toEqual(['last-week']);
		expect(await search('whiteside')).toEqual(['tonight']);
	});

	it('narrows by status, and counts each status in the range', async () => {
		const result = await listStaffCalendar({ status: 'pending_review' }, now);
		expect(ids(result.rows)).toEqual(['this-morning', 'far']);
		expect(result.statusCounts).toEqual({
			draft: 0,
			pending_review: 2,
			published: 1,
			rejected: 0,
			cancelled: 1
		});
	});
});

/**
 * From today starts at club midnight, not UTC's: in the Pacific evening it is
 * already tomorrow in UTC, and today's earlier shows must still list.
 */
describe('club day', () => {
	forEachClockEdge('From today starts at the club calendar day', async (edge) => {
		sqlite.exec('delete from event_listing');
		const midnight = (day: string) => buildDateInTz(day, '00:00', DEFAULT_TIMEZONE);
		const startOfToday = midnight(edge.clubDate);
		await testDb
			.insert(eventListing)
			.values([
				listing('yesterday', new Date(startOfToday.getTime() - 60_000)),
				listing('today', startOfToday),
				listing('tomorrow', midnight(addCalendarDays(edge.clubDate, 1)))
			]);
		const rows = ids((await listStaffCalendar({}, edge.at)).rows);
		expect(rows).toEqual(['today', 'tomorrow']);
	});
});
