import { describe, it, expect, vi, beforeEach } from 'vitest';

// The ShowsBox queries page a band's (or member's) past shows. The service
// fetches PAST_SHOWS_PAGE_SIZE + 1 rows so the remote can tell the client
// whether another page exists — these tests pin that the extra row is used as
// the flag and never leaks into the page, which is what would otherwise make
// "Show more" repeat a row it already rendered.

vi.mock('$app/server', () => ({
	// The real query() parses its argument with the schema before the handler
	// runs, which is where `offset` picks up its default — so the mock does too.
	query: (...args: unknown[]) => {
		const schema = (typeof args[0] === 'function' ? null : args[0]) as {
			parse(v: unknown): unknown;
		} | null;
		const handler = (typeof args[0] === 'function' ? args[0] : args[1]) as (
			...a: unknown[]
		) => unknown;
		const fn = (arg?: unknown) => handler(schema ? schema.parse(arg) : arg);
		(fn as unknown as Record<string, unknown>).__ = { type: 'query' };
		return fn;
	},
	form: (...args: unknown[]) => {
		const handler = (typeof args[0] === 'function' ? args[0] : args[1]) as (
			...a: unknown[]
		) => unknown;
		const marked = handler as unknown as Record<string, unknown>;
		marked.__ = { type: 'form' };
		marked.for = () => handler;
		return handler;
	},
	getRequestEvent: () => ({ locals: {} })
}));

const listBandEventsUpcoming = vi.fn(async (..._a: unknown[]) => [] as unknown[]);
const listBandEventsPast = vi.fn(async (..._a: unknown[]) => [] as unknown[]);
const countBandPastEvents = vi.fn(async (..._a: unknown[]) => 0);
const listMemberUpcomingShows = vi.fn(async (..._a: unknown[]) => [] as unknown[]);
const listMemberPastShows = vi.fn(async (..._a: unknown[]) => [] as unknown[]);
const countMemberPastShows = vi.fn(async (..._a: unknown[]) => 0);

vi.mock('$lib/server/event/event-service', () => ({
	listBandEventsUpcoming: (...a: unknown[]) => listBandEventsUpcoming(...(a as [])),
	listBandEventsPast: (...a: unknown[]) => listBandEventsPast(...(a as [])),
	countBandPastEvents: (...a: unknown[]) => countBandPastEvents(...(a as [])),
	listMemberUpcomingShows: (...a: unknown[]) => listMemberUpcomingShows(...(a as [])),
	listMemberPastShows: (...a: unknown[]) => listMemberPastShows(...(a as [])),
	countMemberPastShows: (...a: unknown[]) => countMemberPastShows(...(a as []))
}));

vi.mock('$lib/server/storage', () => ({
	resolveImageUrl: (key: string | null) => (key ? `https://cdn.test/${key}` : null)
}));
vi.mock('$lib/server/sentry', () => ({ captureException: vi.fn() }));
vi.mock('$lib/server/db', () => ({ db: {} }));
vi.mock('$lib/server/authorization', () => ({ requireUser: () => ({ id: 'u1' }) }));
vi.mock('$lib/server/band/band-context', () => ({ requireBandAdmin: vi.fn() }));

import {
	getBandShows,
	getBandPastShows,
	getMemberShows,
	getMemberPastShows
} from './directory.remote';
import { PAST_SHOWS_PAGE_SIZE } from '$lib/types/calendar';

function fakeRow(id: string, extra: Record<string, unknown> = {}) {
	return {
		id,
		title: id,
		description: null,
		startsAt: new Date('2026-03-04T02:00:00Z'),
		endsAt: new Date('2026-03-04T05:00:00Z'),
		doorsAt: null,
		status: 'published',
		publishedAt: null,
		reservationId: null,
		posterKey: `posters/${id}.jpg`,
		tags: 'rock',
		ticketingEnabled: false,
		ticketPrice: 1000,
		ticketQuantity: null,
		bandId: 'band-1',
		source: 'band',
		location: 'Bombs Away',
		externalTicketUrl: null,
		createdByUserId: 'u1',
		createdAt: new Date(0),
		updatedAt: new Date(0),
		...extra
	};
}

/** A full page plus the sentinel row the service fetches to signal hasMore. */
const overflowPage = () =>
	Array.from({ length: PAST_SHOWS_PAGE_SIZE + 1 }, (_, i) => fakeRow(`past-${i}`));

beforeEach(() => {
	vi.clearAllMocks();
	listBandEventsUpcoming.mockResolvedValue([]);
	listBandEventsPast.mockResolvedValue([]);
	countBandPastEvents.mockResolvedValue(0);
	listMemberUpcomingShows.mockResolvedValue([]);
	listMemberPastShows.mockResolvedValue([]);
	countMemberPastShows.mockResolvedValue(0);
});

describe('getBandShows', () => {
	it('shapes upcoming rows as calendar entries', async () => {
		listBandEventsUpcoming.mockResolvedValue([fakeRow('gig-1')]);

		const { upcoming } = await getBandShows('band-1');

		expect(upcoming).toEqual([
			expect.objectContaining({
				id: 'gig-1',
				title: 'gig-1',
				source: 'band',
				location: 'Bombs Away',
				posterUrl: 'https://cdn.test/posters/gig-1.jpg',
				ticketPrice: 1000,
				// A band's own shows are never joined to the band table — the profile
				// suppresses the byline, so there is nothing to attribute.
				bandName: null,
				bandSlug: null
			})
		]);
	});

	it('returns the first past page and reports more when the service overflows', async () => {
		listBandEventsPast.mockResolvedValue(overflowPage());
		countBandPastEvents.mockResolvedValue(37);

		const shows = await getBandShows('band-1');

		expect(listBandEventsPast).toHaveBeenCalledWith('band-1', {
			limit: PAST_SHOWS_PAGE_SIZE,
			offset: 0
		});
		expect(shows.past).toHaveLength(PAST_SHOWS_PAGE_SIZE);
		expect(shows.past.at(-1)!.id).toBe(`past-${PAST_SHOWS_PAGE_SIZE - 1}`);
		expect(shows.pastHasMore).toBe(true);
		expect(shows.pastCount).toBe(37);
	});

	it('reports no more when the last page is short', async () => {
		listBandEventsPast.mockResolvedValue([fakeRow('past-0'), fakeRow('past-1')]);

		const shows = await getBandShows('band-1');

		expect(shows.past).toHaveLength(2);
		expect(shows.pastHasMore).toBe(false);
	});
});

describe('getBandPastShows', () => {
	it('threads the offset through and drops the overflow row', async () => {
		listBandEventsPast.mockResolvedValue(overflowPage());

		const page = await getBandPastShows({ id: 'band-1', offset: PAST_SHOWS_PAGE_SIZE });

		expect(listBandEventsPast).toHaveBeenCalledWith('band-1', {
			limit: PAST_SHOWS_PAGE_SIZE,
			offset: PAST_SHOWS_PAGE_SIZE
		});
		expect(page.events).toHaveLength(PAST_SHOWS_PAGE_SIZE);
		expect(page.hasMore).toBe(true);
	});

	it('defaults to the first page', async () => {
		await getBandPastShows({ id: 'band-1' });

		expect(listBandEventsPast).toHaveBeenCalledWith('band-1', {
			limit: PAST_SHOWS_PAGE_SIZE,
			offset: 0
		});
	});
});

describe('member shows', () => {
	it('keeps band attribution on aggregated rows', async () => {
		const withBand = fakeRow('gig-2', { bandName: 'The Regressions', bandSlug: 'the-regressions' });
		listMemberUpcomingShows.mockResolvedValue([withBand]);
		listMemberPastShows.mockResolvedValue([withBand]);
		countMemberPastShows.mockResolvedValue(1);

		const shows = await getMemberShows('user-1');

		expect(shows.upcoming[0]).toMatchObject({
			bandName: 'The Regressions',
			bandSlug: 'the-regressions'
		});
		expect(shows.past[0]).toMatchObject({ bandName: 'The Regressions' });
		expect(shows.pastCount).toBe(1);
	});

	it('pages past shows by offset', async () => {
		listMemberPastShows.mockResolvedValue(overflowPage());

		const page = await getMemberPastShows({ id: 'user-1', offset: 40 });

		expect(listMemberPastShows).toHaveBeenCalledWith('user-1', {
			limit: PAST_SHOWS_PAGE_SIZE,
			offset: 40
		});
		expect(page.events).toHaveLength(PAST_SHOWS_PAGE_SIZE);
		expect(page.hasMore).toBe(true);
	});
});
