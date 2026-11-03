import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockUser } from '$lib/server/db/test-factory';

// `getMemberEventDetail` is callable by id from anywhere, so it answers only for
// a signed-in member and only for a listing the public page would show (#2254).

let signedIn = true;
const unauthenticated = () => Object.assign(new Error('401'), { status: 401 });

vi.mock('$lib/server/authorization', () => ({
	can: vi.fn(async () => false),
	requireCapability: vi.fn(async () => {
		throw Object.assign(new Error('403'), { status: 403 });
	}),
	requireUser: vi.fn(() => {
		if (!signedIn) throw unauthenticated();
		return mockUser({ id: 'member-1' });
	})
}));

let status = 'published';
const getById = vi.fn(async (id: string) => ({
	id,
	title: 'Show',
	description: null,
	startsAt: new Date('2030-01-01T20:00:00Z'),
	endsAt: null,
	doorsAt: null,
	location: null,
	tags: null,
	posterKey: null,
	ticketingEnabled: false,
	ticketPrice: null,
	ticketPriceFloorCents: null,
	ticketQuantity: null,
	source: 'cmc',
	externalTicketUrl: null,
	status
}));
vi.mock('$lib/server/event/event-service', async (orig) => ({
	...(await orig<object>()),
	getById: (id: string) => getById(id),
	getEventLineup: vi.fn(async () => []),
	listUpcoming: vi.fn(async () => [])
}));
vi.mock('$lib/server/event/rsvp-service', async (orig) => ({
	...(await orig<object>()),
	countRsvps: vi.fn(async () => 0),
	getUserRsvp: vi.fn(async () => null)
}));
vi.mock('$lib/server/ticket/ticket-seller', () => ({ sellerFor: vi.fn(async () => null) }));
vi.mock('$lib/server/finance/subscription-service', async (orig) => ({
	...(await orig<object>()),
	isSustainingMember: vi.fn(async () => false)
}));

// Kit refuses a remote module whose exports lack the `__` marker.
const mark = (handler: any, type: string) => Object.assign(handler, { __: { type } });
vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		locals: { user: signedIn ? mockUser({ id: 'member-1' }) : null },
		url: new URL('http://localhost/member/events/evt-1'),
		request: { headers: new Headers() }
	}),
	command: (_schema: unknown, handler: (...args: any[]) => any) => mark(handler, 'command'),
	form: (_schema: unknown, handler: (...args: any[]) => any) =>
		Object.assign(mark(handler, 'form'), { for: () => handler, fields: {} }),
	query: (...args: unknown[]) => mark(typeof args[0] === 'function' ? args[0] : args[1], 'query')
}));

const { getMemberEventDetail } = (await import('$lib/remote/events.remote')) as any;

beforeEach(() => {
	vi.clearAllMocks();
	signedIn = true;
	status = 'published';
});

describe('getMemberEventDetail', () => {
	it('refuses a signed-out caller before reading the listing', async () => {
		signedIn = false;
		await expect(getMemberEventDetail('evt-1')).rejects.toMatchObject({ status: 401 });
		expect(getById).not.toHaveBeenCalled();
	});

	it.each(['draft', 'pending_review', 'rejected'])('404s a %s listing', async (s) => {
		status = s;
		await expect(getMemberEventDetail('evt-1')).rejects.toMatchObject({ status: 404 });
	});

	it.each(['published', 'cancelled'])('returns a %s listing', async (s) => {
		status = s;
		const out = await getMemberEventDetail('evt-1');
		expect(out.event).toMatchObject({ id: 'evt-1', status: s });
	});
});
