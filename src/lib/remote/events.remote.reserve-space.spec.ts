import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockUser } from '$lib/server/db/test-factory';

// ---------------------------------------------------------------------------
// Regression: "Reserve practice space" on the New Event modal created no
// reservation at all. The handler only booked the space when BOTH reservation
// times came through, so a submission that checked the box but sent no times
// fell into a silent no-op — event created, no reservation, no error.
//
// The reservation times are an optional override for setup/teardown, not a
// precondition: checking the box must always hold the space.
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

// requireStaff() runs a real role query — one row is all hasAnyRole needs.
function chainable() {
	const proxy: any = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				return (resolve: (v: unknown[]) => void) => resolve([{ roleId: 'role-staff' }]);
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

describe('createEvent — reserve space', () => {
	const base = {
		title: 'Basement Show',
		eventDate: '2026-08-15',
		eventStartTime: '19:00',
		eventEndTime: '22:00',
		ticketingEnabled: false,
		reserveSpace: false,
		overrideConflicts: false,
		recurring: false
	};

	it('holds the event window when no reservation times are supplied', async () => {
		await createEvent({ ...base, reserveSpace: true }, issue);

		const { reservation } = eventServiceMock.create.mock.calls[0][0];
		expect(inClubTime(reservation.startsAt)).toBe('2026-08-15 19:00');
		expect(inClubTime(reservation.endsAt)).toBe('2026-08-15 22:00');
	});

	// Falling back per-field would pair a supplied start with a defaulted end, and
	// buildTimeRangeInTz reads an end before the start as an overnight range — a
	// 23:00 start against the event's 22:00 end rolls onto the next day and holds
	// the room for 23 hours. Half a window is no window.
	it('holds the event window when only one reservation time is supplied', async () => {
		await createEvent({ ...base, reserveSpace: true, reservationStartTime: '23:00' }, issue);

		const { reservation } = eventServiceMock.create.mock.calls[0][0];
		expect(inClubTime(reservation.startsAt)).toBe('2026-08-15 19:00');
		expect(inClubTime(reservation.endsAt)).toBe('2026-08-15 22:00');
	});

	it('prefers the supplied setup/teardown window over the event times', async () => {
		await createEvent(
			{
				...base,
				reserveSpace: true,
				reservationStartTime: '17:00',
				reservationEndTime: '23:30'
			},
			issue
		);

		const { reservation } = eventServiceMock.create.mock.calls[0][0];
		expect(inClubTime(reservation.startsAt)).toBe('2026-08-15 17:00');
		expect(inClubTime(reservation.endsAt)).toBe('2026-08-15 23:30');
	});

	it('books nothing when the box is left unchecked', async () => {
		await createEvent(base, issue);

		expect(eventServiceMock.create.mock.calls[0][0].reservation).toBeUndefined();
	});
});
