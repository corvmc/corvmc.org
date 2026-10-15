import { describe, it, expect, beforeEach, vi } from 'vitest';

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

vi.mock('$lib/server/db', () => ({ db: testDb }));

const { getCalendarTotals, calendarWindows } = await import('./calendar-totals-service');
const { user } = await import('$lib/server/db/schema/authentication');
const { eventListing } = await import('$lib/server/db/schema/event');

// Wednesday 14 Oct 2026, 11:00 in Corvallis (PDT, UTC-7).
const NOW = new Date('2026-10-14T18:00:00Z');

beforeEach(async () => {
	sqlite.exec('DELETE FROM event_listing; DELETE FROM user');
	await testDb.insert(user).values({ id: 'u', name: 'u', email: 'u@example.com' });
});

type Listing = typeof eventListing.$inferInsert;
const ev = (title: string, startsAt: string, over: Partial<Listing> = {}): Listing => ({
	title,
	startsAt: new Date(startsAt),
	endsAt: new Date(new Date(startsAt).getTime() + 2 * 60 * 60 * 1000),
	status: 'published',
	source: 'cmc',
	createdByUserId: 'u',
	...over
});

describe('calendarWindows', () => {
	it('ends the week at Monday midnight and the month at the 1st, in venue time', () => {
		const w = calendarWindows(NOW);
		expect(w.from.toISOString()).toBe('2026-10-14T07:00:00.000Z');
		expect(w.weekEnd.toISOString()).toBe('2026-10-19T07:00:00.000Z');
		expect(w.monthEnd.toISOString()).toBe('2026-11-01T07:00:00.000Z');
	});

	it('treats Sunday as the last day of its week, and rolls December into January', () => {
		const sunday = calendarWindows(new Date('2026-12-27T20:00:00Z'));
		expect(sunday.weekEnd.toISOString()).toBe('2026-12-28T08:00:00.000Z');
		expect(sunday.monthEnd.toISOString()).toBe('2027-01-01T08:00:00.000Z');
	});
});

describe('getCalendarTotals', () => {
	it('is all zeros with nothing listed', async () => {
		expect(await getCalendarTotals(NOW)).toEqual({ thisWeek: 0, thisMonth: 0, needsReview: 0 });
	});

	it('counts what the calendar shows this week and month, and the whole queue', async () => {
		await testDb.insert(eventListing).values([
			ev('yesterday', '2026-10-13T20:00:00Z'),
			ev('tonight', '2026-10-15T03:00:00Z'),
			ev('sunday night', '2026-10-19T03:00:00Z'),
			ev('monday', '2026-10-19T17:00:00Z'),
			ev('halloween, cancelled', '2026-10-31T19:00:00Z', { status: 'cancelled' }),
			ev('november', '2026-11-02T03:00:00Z'),
			ev('stale pending', '2026-10-01T03:00:00Z', {
				status: 'pending_review',
				source: 'community'
			}),
			ev('pending', '2026-10-16T03:00:00Z', { status: 'pending_review', source: 'community' }),
			ev('draft', '2026-10-16T03:00:00Z', { status: 'draft', source: 'community' }),
			ev('rejected', '2026-10-16T03:00:00Z', { status: 'rejected', source: 'community' })
		]);

		expect(await getCalendarTotals(NOW)).toEqual({ thisWeek: 2, thisMonth: 4, needsReview: 2 });
	});
});
