import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockUser } from '#lib/server/db/test-factory.js';

// `getPublicEventDetail` is the slowest page's one read. Its reads need only the
// listing, so they must all be in flight before any of them answers (#3365).

let release!: () => void;
let gate: Promise<void>;
const arm = () => {
	gate = new Promise<void>((resolve) => (release = resolve));
};
const slow = <T>(value: T) =>
	vi.fn(async (..._args: unknown[]) => {
		await gate;
		return value;
	});

const reads = {
	getEventLineup: slow([]),
	getPublicSetTimes: slow([]),
	getVenueAccess: slow(null),
	getTicketsRemaining: slow(10),
	countRsvps: slow(0),
	listUpcoming: slow([]),
	listEventPhotos: slow([{ attachmentId: 'p1', url: 'u', altText: null, caption: null }]),
	creditsForEvent: slow([]),
	recapUploadAccess: slow('photographer'),
	sellerFor: slow({ shareBps: 1000 }),
	isSustainingMember: slow(true),
	groupSelect: slow([{ name: 'Band', slug: 'band' }])
};

const event = {
	id: 'evt-1',
	title: 'Show',
	description: null,
	startsAt: new Date('2030-01-01T20:00:00Z'),
	endsAt: null,
	doorsAt: null,
	location: null,
	address: null,
	tags: null,
	posterKey: null,
	groupId: 'grp-1',
	venueId: null,
	ticketingEnabled: false,
	ticketPrice: null,
	ticketPriceFloorCents: null,
	ticketQuantity: null,
	source: 'cmc',
	kind: 'show',
	externalTicketUrl: null,
	recapText: null,
	status: 'published'
};
let current: Record<string, unknown> | null = event;
const getById = vi.fn(async () => current);

vi.mock('#lib/server/authorization.js', () => ({
	can: vi.fn(async () => false),
	userHasCapability: vi.fn(async () => false),
	requireCapability: vi.fn(),
	requireUser: vi.fn()
}));
vi.mock('#lib/server/event/event-service.js', async (orig) => ({
	...(await orig<object>()),
	getById: () => getById(),
	getEventLineup: (...a: unknown[]) => reads.getEventLineup(...a),
	listUpcoming: (...a: unknown[]) => reads.listUpcoming(...a)
}));
vi.mock('#lib/server/event/rsvp-service.js', async (orig) => ({
	...(await orig<object>()),
	countRsvps: (...a: unknown[]) => reads.countRsvps(...a)
}));
vi.mock('#lib/server/event/event-photo-service.js', async (orig) => ({
	...(await orig<object>()),
	listEventPhotos: (...a: unknown[]) => reads.listEventPhotos(...a)
}));
vi.mock('#lib/server/event/recap-access.js', () => ({
	recapUploadAccess: (...a: unknown[]) => reads.recapUploadAccess(...a)
}));
vi.mock('#lib/server/production/run-of-show-service.js', async (orig) => ({
	...(await orig<object>()),
	getPublicSetTimes: (...a: unknown[]) => reads.getPublicSetTimes(...a)
}));
vi.mock('#lib/server/sponsor/credit-service.js', async (orig) => ({
	...(await orig<object>()),
	creditsForEvent: (...a: unknown[]) => reads.creditsForEvent(...a)
}));
vi.mock('#lib/server/ticket/ticket-seller.js', () => ({
	sellerFor: (...a: unknown[]) => reads.sellerFor(...a)
}));
vi.mock('#lib/server/ticket/ticket-service.js', async (orig) => ({
	...(await orig<object>()),
	getTicketsRemaining: (...a: unknown[]) => reads.getTicketsRemaining(...a)
}));
vi.mock('#lib/server/finance/subscription-service.js', async (orig) => ({
	...(await orig<object>()),
	isSustainingMember: (...a: unknown[]) => reads.isSustainingMember(...a)
}));
vi.mock('#lib/server/venue/venue-service.js', async (orig) => ({
	...(await orig<object>()),
	getVenueAccess: (...a: unknown[]) => reads.getVenueAccess(...a)
}));
vi.mock('#lib/server/db/index.js', async (orig) => {
	const chain: any = {
		select: () => chain,
		from: () => chain,
		where: () => chain,
		limit: () => reads.groupSelect()
	};
	return { ...(await orig<object>()), db: chain };
});

const mark = (handler: any, type: string) => Object.assign(handler, { __: { type } });
vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		locals: { user: mockUser({ id: 'member-1' }) },
		url: new URL('http://localhost/events/evt-1'),
		request: { headers: new Headers() }
	}),
	command: (_schema: unknown, handler: (...args: any[]) => any) => mark(handler, 'command'),
	form: (_schema: unknown, handler: (...args: any[]) => any) =>
		Object.assign(mark(handler, 'form'), { for: () => handler, fields: {} }),
	query: (...args: unknown[]) => mark(typeof args[0] === 'function' ? args[0] : args[1], 'query')
}));

const { getPublicEventDetail } = (await import('#lib/remote/events.remote.js')) as any;

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
	vi.clearAllMocks();
	current = event;
	arm();
});

describe('getPublicEventDetail', () => {
	it('starts every read before any of them answers', async () => {
		const pending = getPublicEventDetail('evt-1');
		await tick();
		// A read that waits on another would not have been called yet.
		for (const [name, read] of Object.entries(reads)) {
			if (name === 'getTicketsRemaining') continue; // unticketed: counts RSVPs instead
			expect(read, name).toHaveBeenCalledTimes(1);
		}
		release();
		const out = await pending;
		expect(out.event.bandSlug).toBe('band');
		expect(out.recapUpload?.remaining).toBeGreaterThan(0);
	});

	it('404s an unknown listing without reading anything else', async () => {
		current = null;
		await expect(getPublicEventDetail('evt-1')).rejects.toMatchObject({ status: 404 });
		expect(reads.getEventLineup).not.toHaveBeenCalled();
	});

	it('404s a draft listing without reading anything else', async () => {
		current = { ...event, status: 'draft' };
		await expect(getPublicEventDetail('evt-1')).rejects.toMatchObject({ status: 404 });
		expect(reads.getEventLineup).not.toHaveBeenCalled();
	});
});
