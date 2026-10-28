import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Closures as rows of the reservations list. The window predicates decide which
 * page a closure lands on, so they run against a real SQLite: a closure that
 * falls between two pages must land on exactly one of them.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

vi.mock('$lib/server/db', () => ({ db: testDb }));

const { closuresInWindow, closuresOverlapping, closuresPage, countClosures, interleave } =
	await import('./closure-timeline');

/** Seconds, which is what `mode: 'timestamp'` stores. */
const at = (s: number) => new Date(s * 1000);
const now = at(5000);
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

beforeEach(() => {
	sqlite.exec('delete from closure');
	sqlite.exec(
		`insert into closure (id, reason, starts_at, ends_at) values
			('past', 'Floor refinishing', 1000, 2000),
			('soon', 'Deep clean', 6000, 7000),
			('later', 'Inspection', 9000, 9500)`
	);
});

describe('closuresInWindow', () => {
	const all = { upcomingOnly: false };

	it('keeps Upcoming to closures not yet over', async () => {
		const rows = await closuresInWindow({ upcomingOnly: true }, now, 'asc', {});
		expect(ids(rows)).toEqual(['soon', 'later']);
	});

	it('splits on page boundaries with nothing lost or doubled, ascending', async () => {
		const page1 = await closuresInWindow(all, now, 'asc', { next: at(6000) });
		const page2 = await closuresInWindow(all, now, 'asc', { first: at(6000) });
		expect(ids(page1)).toEqual(['past']);
		expect(ids(page2)).toEqual(['soon', 'later']);
	});

	it('splits on page boundaries with nothing lost or doubled, descending', async () => {
		const page1 = await closuresInWindow(all, now, 'desc', { next: at(6000) });
		const page2 = await closuresInWindow(all, now, 'desc', { first: at(6000) });
		expect(ids(page1)).toEqual(['later']);
		expect(ids(page2)).toEqual(['soon', 'past']);
	});

	it('matches a search against the reason', async () => {
		const rows = await closuresInWindow({ upcomingOnly: false, search: 'clean' }, now, 'asc', {});
		expect(ids(rows)).toEqual(['soon']);
	});
});

describe('closuresPage', () => {
	it('pages closures alone and says how many there are', async () => {
		const { rows, pagination } = await closuresPage({ upcomingOnly: false }, now, 'desc', 1, 2);
		expect(ids(rows)).toEqual(['later', 'soon']);
		expect(rows[0].kind).toBe('closure');
		expect(pagination).toMatchObject({ total: 3, totalPages: 2 });
	});
});

describe('countClosures', () => {
	it('counts upcoming the way the Upcoming tab filters', async () => {
		expect(await countClosures(now)).toEqual({ upcoming: 2, all: 3 });
	});
});

describe('interleave', () => {
	const booking = (id: string, s: number) => ({ id, startsAt: at(s) });
	const closure = (id: string, s: number) => ({
		kind: 'closure' as const,
		id,
		reason: id,
		startsAt: at(s),
		endsAt: at(s + 100)
	});

	it('merges by start time, the closure first on a tie', () => {
		const rows = [booking('a', 100), booking('b', 300)];
		const merged = interleave(rows, [closure('c', 300), closure('d', 400)], 'asc');
		expect(ids(merged)).toEqual(['a', 'c', 'b', 'd']);
	});

	it('merges a descending page the other way round', () => {
		const rows = [booking('b', 300), booking('a', 100)];
		const merged = interleave(rows, [closure('d', 400), closure('c', 200)], 'desc');
		expect(ids(merged)).toEqual(['d', 'b', 'c', 'a']);
	});
});

// The reservation page's day timeline: anything blocking the room that day,
// including a closure that began the day before or runs past it.
describe('closuresOverlapping', () => {
	it('returns closures that overlap the range, partly or wholly', async () => {
		expect(ids(await closuresOverlapping(at(1500), at(6500)))).toEqual(['past', 'soon']);
	});

	it('leaves out closures that only touch the range at an edge', async () => {
		expect(ids(await closuresOverlapping(at(2000), at(6000)))).toEqual([]);
	});
});
