import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockUser } from '$lib/server/db/test-factory';

// ---------------------------------------------------------------------------
// "Reserve practice space" moved off the New Event modal. The update-side
// regressions for it are in events.remote.reserve-space-update.spec.ts.
// ---------------------------------------------------------------------------

const eventServiceMock = {
	create: vi.fn(async (_params: any) => ({ id: 'event-1' })),
	update: vi.fn(async (_id: string, _params: any) => ({ id: 'event-1' })),
	checkRebookNeeded: vi.fn(),
	publish: vi.fn(),
	unpublish: vi.fn(),
	cancel: vi.fn(),
	getById: vi.fn(async () => ({ id: 'event-1' })),
	listAll: vi.fn(async () => []),
	listUpcoming: vi.fn(async () => []),
	listPast: vi.fn(async () => [])
};

vi.mock('$lib/server/event/event-service', () => eventServiceMock);

vi.mock('$lib/server/reservation/recurring-series-service', () => ({
	createEventSeries: vi.fn(async () => ({ id: 'series-1' })),
	getByEvent: vi.fn(async () => null),
	getEventSeries: vi.fn(async () => null),
	cancel: vi.fn()
}));

vi.mock('$lib/server/feature-flags', () => ({
	isFeatureEnabled: vi.fn(async () => true),
	requireFeature: vi.fn(async () => undefined)
}));

// The capability guard runs a real role query. It reads role NAMES and keeps
// only the ones that name a position, so the row has to carry one — a bare
// row was enough when the guard only counted them.
function chainable() {
	const proxy: any = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				return (resolve: (v: unknown[]) => void) => resolve([{ name: 'staff' }]);
			}
			return () => proxy;
		}
	});
	return proxy;
}

vi.mock('$lib/server/db', () => ({
	db: { select: () => chainable() }
}));

const staffUser = mockUser({ id: 'staff-1', name: 'Front Desk', email: 'staff@example.com' });

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		locals: { user: staffUser },
		url: new URL('http://localhost/staff/events'),
		request: { headers: new Headers() }
	}),
	// `scanTicketIn` is a command (#933), so the module now needs one.
	command: (_schema: unknown, handler: (...args: any[]) => any) => {
		(handler as any).__ = { type: 'command' };
		return handler;
	},
	form: (_schema: unknown, handler: (...args: any[]) => any) => {
		const fn = handler;
		(fn as any).__ = { type: 'form' };
		(fn as any).for = () => fn;
		return fn;
	},
	query: (...args: unknown[]) => {
		const handler = typeof args[0] === 'function' ? args[0] : args[1];
		(handler as any).__ = { type: 'query' };
		return handler as (...args: any[]) => any;
	}
}));

const { createEvent } = (await import('$lib/remote/events.remote')) as any;

const issue: any = new Proxy(() => undefined, { get: () => () => undefined });

/** Read a built instant back as "YYYY-MM-DD HH:mm" in club time. */
function inClubTime(d: Date): string {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone: 'America/Los_Angeles',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	}).formatToParts(d);
	const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
	return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

beforeEach(() => {
	vi.clearAllMocks();
});

// The room is held from the console's edit form now (#1822's rule), so create
// passes no reservation whatever the request carries.
describe('createEvent — holds nothing at create', () => {
	const base = {
		title: 'Basement Show',
		eventDate: '2026-08-15',
		eventStartTime: '19:00',
		eventEndTime: '22:00',
		kind: 'show' as const
	};

	it('creates the row with no reservation and no ticket sale', async () => {
		await createEvent(base, issue);

		const params = eventServiceMock.create.mock.calls[0][0];
		expect(params.reservation).toBeUndefined();
		expect(params.ticketingEnabled).toBeUndefined();
		expect(inClubTime(params.startsAt)).toBe('2026-08-15 19:00');
		expect(inClubTime(params.endsAt)).toBe('2026-08-15 22:00');
	});

	it('opens no production: the Calendar posts a listing, not a show to run (#1947)', async () => {
		await createEvent({ ...base, withProduction: true }, issue);

		expect(eventServiceMock.create.mock.calls[0][0].withProduction).toBeUndefined();
	});
});
