import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — a select chain that records the where clause and limit/offset so the
// filters can be asserted, and resolves to configurable joined rows.
// ---------------------------------------------------------------------------

let capturedWhere: unknown;
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
	listPublicCalendarEvents,
	listPublicUpcomingEvents,
	listStaffCalendar
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
 * The staff calendar. Same window as the gig guide, but it also carries the
 * rows asking to join it, which is what the moderation surface is for.
 */
describe('listStaffCalendar', () => {
	it('reads every source, so a duplicate of a CMC show is visible beside it', async () => {
		await listStaffCalendar(windowStart, { statuses: ['pending_review'] });
		expect(containsParam(capturedWhere, 'cmc')).toBe(false);
		expect(containsParam(capturedWhere, 'band')).toBe(false);
	});

	it('narrows by source when the filter asks it to', async () => {
		await listStaffCalendar(windowStart, {
			statuses: ['published'],
			sources: ['community']
		});
		expect(containsParam(capturedWhere, 'community')).toBe(true);
	});

	/**
	 * The badge and the queue have to agree. `countPendingSubmissions` counts
	 * every `pending_review` row with no date filter, so flooring them here would
	 * strand a listing whose date passed while it waited — counted in the sidebar,
	 * absent from the only page that can clear it.
	 */
	it('does not floor pending rows by date, so a stale listing stays reachable', async () => {
		await listStaffCalendar(windowStart, { statuses: ['pending_review'] });
		expect(containsParam(capturedWhere, windowStart)).toBe(true);
		// The floor is there, but guarded by the public-status test rather than
		// applied to every row.
		expect(containsParam(capturedWhere, 'published')).toBe(true);
		expect(containsParam(capturedWhere, 'cancelled')).toBe(true);
	});

	/**
	 * Two guards, and this is the second. The remote's Zod enum omits `draft`,
	 * but the status list still arrives from the caller — a member's private
	 * working copy must not become staff-visible because someone widened an enum.
	 */
	it('excludes community drafts even when draft is passed explicitly', async () => {
		await listStaffCalendar(windowStart, { statuses: ['draft'] });
		expect(containsParam(capturedWhere, 'community')).toBe(true);
		expect(containsParam(capturedWhere, 'draft')).toBe(true);
	});
});
