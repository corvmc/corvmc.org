import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Mocks — a select chain that records the where clause and limit/offset so the
// filters can be asserted, and resolves to configurable joined rows.
// ---------------------------------------------------------------------------

let capturedWhere: unknown;
let capturedOrderBy: unknown[] = [];
let capturedLimit: number | undefined;
let capturedOffset: number | undefined;
let selectRows: unknown[] = [];

function chain(): unknown {
	const proxy: unknown = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				return (resolve: (v: unknown[]) => void) => resolve(selectRows);
			}
			if (prop === 'where') {
				return (clause: unknown) => {
					capturedWhere = clause;
					return proxy;
				};
			}
			if (prop === 'orderBy') {
				return (...clauses: unknown[]) => {
					capturedOrderBy = clauses;
					return proxy;
				};
			}
			if (prop === 'limit') {
				return (n: number) => {
					capturedLimit = n;
					return proxy;
				};
			}
			if (prop === 'offset') {
				return (n: number) => {
					capturedOffset = n;
					return proxy;
				};
			}
			return () => proxy;
		}
	});
	return proxy;
}

vi.mock('$lib/server/db', () => ({
	db: { select: () => chain() },
	getRowCount: () => 0
}));

vi.mock('$lib/server/reservation/reservation-service', () => ({
	staffCreate: vi.fn(),
	cancel: vi.fn(),
	ReservationConflictError: class extends Error {}
}));
vi.mock('$lib/server/reservation/conflict-service', () => ({ hasConflict: vi.fn() }));
vi.mock('$lib/server/event-bus/event-bus', () => ({ domainEvents: { emit: vi.fn() } }));
vi.mock('$lib/server/storage', () => ({ uploadFile: vi.fn(), deleteObject: vi.fn() }));

import {
	listEventsNear,
	listPublicCalendarEvents,
	listPublicUpcomingEvents,
	listStaffCalendar,
	listUpcoming,
	listPast,
	getShowTonight
} from './event-service';

/**
 * Depth-first search of a drizzle SQL tree for a bound parameter value.
 *
 * Walks plain arrays as well as `queryChunks`: `inArray()` puts its bound
 * params in a bare array, so a chunks-only walk silently reports `false` for
 * every value in an IN clause.
 */
function containsParam(node: unknown, value: unknown): boolean {
	if (!node || typeof node !== 'object') return false;
	if ((node as { value?: unknown }).value === value) return true;
	if (Array.isArray(node)) return node.some((c) => containsParam(c, value));
	const chunks = (node as { queryChunks?: unknown[] }).queryChunks;
	return Array.isArray(chunks) && chunks.some((c) => containsParam(c, value));
}

/**
 * `containsParam` compares with `===`, and two `Date`s never satisfy that even
 * when they name the same instant — so a bound date has to be matched by value.
 */
function containsDate(node: unknown, value: Date): boolean {
	if (!node || typeof node !== 'object') return false;
	const v = (node as { value?: unknown }).value;
	if (v instanceof Date && v.getTime() === value.getTime()) return true;
	if (Array.isArray(node)) return node.some((c) => containsDate(c, value));
	const chunks = (node as { queryChunks?: unknown[] }).queryChunks;
	return Array.isArray(chunks) && chunks.some((c) => containsDate(c, value));
}

const cmcEvent = {
	id: 'evt-cmc',
	title: 'Open Mic Night',
	source: 'cmc',
	startsAt: new Date('2026-08-08T02:00:00Z'),
	endsAt: new Date('2026-08-08T05:00:00Z')
};

const bandEvent = {
	id: 'evt-band',
	title: 'Basement Show',
	source: 'band',
	startsAt: new Date('2026-08-09T02:00:00Z'),
	endsAt: new Date('2026-08-09T05:00:00Z')
};

const windowStart = new Date('2026-08-01T07:00:00Z');
const windowEnd = new Date('2026-09-01T07:00:00Z');

beforeEach(() => {
	capturedWhere = undefined;
	capturedOrderBy = [];
	capturedLimit = undefined;
	capturedOffset = undefined;
	selectRows = [];
});

describe('listPublicCalendarEvents', () => {
	it('maps joined band info onto rows, null for CMC rows', async () => {
		selectRows = [
			{ event: cmcEvent, bandName: null, bandSlug: null },
			{ event: bandEvent, bandName: 'The Shakes', bandSlug: 'the-shakes' }
		];

		const result = await listPublicCalendarEvents(windowStart, windowEnd);

		expect(result).toHaveLength(2);
		expect(result[0]).toMatchObject({ id: 'evt-cmc', bandName: null, bandSlug: null });
		expect(result[1]).toMatchObject({
			id: 'evt-band',
			bandName: 'The Shakes',
			bandSlug: 'the-shakes'
		});
	});

	// Band gigs used to be gated behind the `bandEvents` flag. The flag is gone,
	// but "a band gig reaches the public calendar" is still the behaviour worth
	// pinning — it just holds unconditionally now.
	it('applies no source filter, so band gigs are on the calendar', async () => {
		await listPublicCalendarEvents(windowStart, windowEnd);
		expect(containsParam(capturedWhere, 'cmc')).toBe(false);
	});

	// A cancelled show belongs on the guide: the cancellation IS the
	// announcement, and the people who need it are the ones who already had the
	// date. A `rejected` listing is its exact opposite — never public, and it
	// must not become public by riding along here.
	it('shows published and cancelled events, and nothing else', async () => {
		await listPublicCalendarEvents(windowStart, windowEnd);

		expect(containsParam(capturedWhere, 'published')).toBe(true);
		expect(containsParam(capturedWhere, 'cancelled')).toBe(true);
		expect(containsParam(capturedWhere, 'rejected')).toBe(false);
		expect(containsParam(capturedWhere, 'draft')).toBe(false);
		expect(containsParam(capturedWhere, 'pending_review')).toBe(false);
	});
});

describe('listPublicUpcomingEvents', () => {
	it('maps joined band info and shows only publicly visible statuses', async () => {
		selectRows = [{ event: bandEvent, bandName: 'The Shakes', bandSlug: 'the-shakes' }];

		const result = await listPublicUpcomingEvents(windowStart, { limit: 20, offset: 0 });

		expect(result[0]).toMatchObject({ id: 'evt-band', bandName: 'The Shakes' });
		expect(containsParam(capturedWhere, 'published')).toBe(true);
		expect(containsParam(capturedWhere, 'cancelled')).toBe(true);
		// The one that would publish something staff turned down.
		expect(containsParam(capturedWhere, 'rejected')).toBe(false);
		expect(containsParam(capturedWhere, 'pending_review')).toBe(false);
	});

	it('fetches limit+1 rows at the given offset (hasMore probe)', async () => {
		await listPublicUpcomingEvents(windowStart, { limit: 20, offset: 40 });
		expect(capturedLimit).toBe(21);
		expect(capturedOffset).toBe(40);
	});

	it('applies no source filter, so band gigs are in the gig guide', async () => {
		await listPublicUpcomingEvents(windowStart, { limit: 20, offset: 0 });
		expect(containsParam(capturedWhere, 'cmc')).toBe(false);
	});
});

/**
 * The staff calendar lists every listing staff may see, past and future, in
 * every status. The one exclusion is a community draft, its author's alone.
 */
describe('listStaffCalendar', () => {
	it('applies no status, source or date filter', async () => {
		await listStaffCalendar({ page: 1 });
		for (const status of ['pending_review', 'published', 'cancelled', 'rejected']) {
			expect(containsParam(capturedWhere, status)).toBe(false);
		}
		expect(containsParam(capturedWhere, 'cmc')).toBe(false);
		expect(containsParam(capturedWhere, 'band')).toBe(false);
	});

	// A listing waiting on staff is pinned above every date, so a stale one is
	// never buried pages down.
	it('orders pending_review rows first', async () => {
		await listStaffCalendar({ page: 1 });
		const first = new SQLiteSyncDialect().sqlToQuery(capturedOrderBy[0] as SQL);
		expect(first.params).toContain('pending_review');
	});

	it('excludes community drafts', async () => {
		await listStaffCalendar({ page: 1 });
		expect(containsParam(capturedWhere, 'community')).toBe(true);
		expect(containsParam(capturedWhere, 'draft')).toBe(true);
	});
});

/**
 * The two-hour window on the staff event view. A *window*, not a day: two shows
 * on one date are ordinary, two shows in one slot are the duplicate the
 * moderation screen exists to catch.
 */
describe('listEventsNear', () => {
	const showAt = new Date('2026-08-08T02:00:00Z');

	it('bounds the window on both sides of the show', async () => {
		await listEventsNear(showAt, { excludeEventId: 'evt-self' });
		// ±120 minutes by default.
		expect(containsDate(capturedWhere, new Date(showAt.getTime() - 120 * 60_000))).toBe(true);
		expect(containsDate(capturedWhere, new Date(showAt.getTime() + 120 * 60_000))).toBe(true);
	});

	it('honours a caller-supplied window', async () => {
		await listEventsNear(showAt, { excludeEventId: 'evt-self', windowMinutes: 30 });
		expect(containsDate(capturedWhere, new Date(showAt.getTime() - 30 * 60_000))).toBe(true);
		expect(containsDate(capturedWhere, new Date(showAt.getTime() + 120 * 60_000))).toBe(false);
	});

	it('excludes the event being judged', async () => {
		await listEventsNear(showAt, { excludeEventId: 'evt-self' });
		expect(containsParam(capturedWhere, 'evt-self')).toBe(true);
	});

	/**
	 * The reason this is not `checkForDuplicate`: that one filters to `published`,
	 * so two pending submissions of one gig never see each other.
	 */
	it('includes pending_review, which the published-only heuristic could not', async () => {
		await listEventsNear(showAt, { excludeEventId: 'evt-self' });
		expect(containsParam(capturedWhere, 'pending_review')).toBe(true);
	});

	it('applies no source filter, so a member re-posting our own show is visible', async () => {
		await listEventsNear(showAt, { excludeEventId: 'evt-self' });
		expect(containsParam(capturedWhere, 'cmc')).toBe(false);
		expect(containsParam(capturedWhere, 'band')).toBe(false);
	});

	it("keeps a member's private working copy out", async () => {
		await listEventsNear(showAt, { excludeEventId: 'evt-self' });
		expect(containsParam(capturedWhere, 'community')).toBe(true);
		expect(containsParam(capturedWhere, 'draft')).toBe(true);
	});
});

/**
 * The homepage posters, "show tonight" and the past-shows strip are the three
 * surfaces that mean *shows* rather than *listings*. They got that by filtering
 * `source = 'cmc'`, which held only while every CMC event was a gig — work
 * parties and monthly deep cleans get listings too, because they need
 * advertising as much as a show does. `kind` is what carries the distinction
 * now, and these assert it at every one of the three call sites.
 *
 * The public guide is the control: it must keep showing the work party.
 */
describe('shows vs listings', () => {
	it('listUpcoming asks for shows only', async () => {
		await listUpcoming();

		expect(containsParam(capturedWhere, 'show')).toBe(true);
		expect(containsParam(capturedWhere, 'cmc')).toBe(true);
		expect(containsParam(capturedWhere, 'published')).toBe(true);
	});

	it('listPast asks for shows only', async () => {
		await listPast();

		expect(containsParam(capturedWhere, 'show')).toBe(true);
	});

	it('getShowTonight asks for shows only', async () => {
		await getShowTonight(new Date('2026-08-08T02:00:00Z'));

		expect(containsParam(capturedWhere, 'show')).toBe(true);
	});

	it('the public calendar does not filter on kind, so a work party still lists', async () => {
		await listPublicCalendarEvents(windowStart, windowEnd);

		expect(containsParam(capturedWhere, 'show')).toBe(false);
	});

	it('the public upcoming list does not filter on kind either', async () => {
		await listPublicUpcomingEvents(windowStart, { limit: 20, offset: 0 });

		expect(containsParam(capturedWhere, 'show')).toBe(false);
	});
});
