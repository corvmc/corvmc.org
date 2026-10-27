import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * #1990. A club's session is `source: 'group'`, and `processEventSeries` repeats
 * one (inheriting source and groupId, re-booking the room), but this entry point
 * refused anything that was not CMC's own — so staff moved the date by hand.
 */

const getById = vi.fn();
const createEventSeries = vi.fn(async () => ({ id: 'series-1' }));

vi.mock('$lib/server/event/event-service', () => ({
	create: vi.fn(),
	update: vi.fn(),
	checkRebookNeeded: vi.fn(),
	publish: vi.fn(),
	publishBlockers: vi.fn(async () => []),
	unpublishWithNotice: vi.fn(),
	remove: vi.fn(),
	getDeletionImpact: vi.fn(),
	cancel: vi.fn(),
	getById: (...a: unknown[]) => getById(...a),
	listAll: vi.fn(),
	listStaffCalendar: vi.fn(),
	listEventsNear: vi.fn(),
	listUpcoming: vi.fn(),
	listPast: vi.fn(),
	getEventLineup: vi.fn(),
	getEventLineups: vi.fn(),
	setEventLineup: vi.fn(),
	listMemberUpcomingShows: vi.fn(),
	listMemberPastShows: vi.fn(),
	countMemberPastShows: vi.fn()
}));
vi.mock('$lib/server/errors', () => ({
	DomainError: Error,
	mapDomainError: (err: unknown): never => {
		throw err;
	}
}));
vi.mock('$lib/server/authorization', () => ({
	requireCapability: vi.fn(async () => ({ id: 'staff-1' })),
	// `requireListingWriter` asks this first; the caller here is staff.
	can: vi.fn(async () => true),
	requireUser: vi.fn(() => ({ id: 'staff-1' }))
}));
vi.mock('$lib/server/reservation/conflict-service', () => ({
	getConflictDetails: vi.fn(),
	getValidationWarnings: vi.fn()
}));
vi.mock('$lib/server/reservation/recurring-series-service', () => ({
	createEventSeries: (...a: unknown[]) => createEventSeries(...(a as [])),
	getByEvent: vi.fn(),
	getEventSeries: vi.fn(),
	cancel: vi.fn()
}));
vi.mock('$lib/server/reservation/rrule-helpers', () => ({
	buildRRule: vi.fn(),
	getOccurrences: vi.fn()
}));
vi.mock('$lib/server/finance/subscription-service', () => ({
	isSustainingMember: vi.fn(async () => false)
}));
vi.mock('$lib/server/finance/product-config-service', () => ({ buildLineItem: vi.fn() }));
vi.mock('$lib/server/finance/payment-service', () => ({ checkout: vi.fn() }));
vi.mock('$lib/server/storage', () => ({ resolveImageUrl: vi.fn() }));
vi.mock('$lib/server/feature-flags', () => ({
	isFeatureEnabled: vi.fn(async () => true),
	requireFeature: vi.fn(async () => undefined)
}));
vi.mock('$lib/server/db', () => ({ db: {} }));

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		locals: { user: { id: 'staff-1' } },
		url: new URL('http://localhost/'),
		request: { headers: new Headers() }
	}),
	query: (...args: unknown[]) => tag(args, 'query'),
	command: (...args: unknown[]) => tag(args, 'command'),
	form: (...args: unknown[]) => tag(args, 'form')
}));

function tag(args: unknown[], type: string) {
	const handler = (typeof args[0] === 'function' ? args[0] : args[1]) as Record<string, unknown>;
	handler.__ = { type };
	handler.for = () => handler;
	handler.refresh = () => Promise.resolve();
	return handler;
}

const events = (await import('./events.remote')) as unknown as Record<
	string,
	(data: unknown) => Promise<unknown>
>;

const startsAt = new Date('2026-11-05T02:00:00Z');
const SERIES = { eventId: 'evt-1', recurringFrequency: 'weekly' };

beforeEach(() => vi.clearAllMocks());

describe('startEventSeries', () => {
	it('repeats a club session', async () => {
		getById.mockResolvedValueOnce({ id: 'evt-1', source: 'group', groupId: 'g-1', startsAt });

		await expect(events.startEventSeries(SERIES)).resolves.toEqual({ success: true });
		expect(createEventSeries).toHaveBeenCalledWith(
			expect.objectContaining({ prototypeEventId: 'evt-1', frequency: 'weekly' })
		);
	});

	it('still repeats a CMC event', async () => {
		getById.mockResolvedValueOnce({ id: 'evt-1', source: 'cmc', startsAt });

		await expect(events.startEventSeries(SERIES)).resolves.toEqual({ success: true });
	});

	it.each(['band', 'community'])('refuses a %s listing', async (source) => {
		getById.mockResolvedValueOnce({ id: 'evt-1', source, startsAt });

		await expect(events.startEventSeries(SERIES)).rejects.toMatchObject({ status: 400 });
		expect(createEventSeries).not.toHaveBeenCalled();
	});
});
