import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockUser } from '$lib/server/db/test-factory';

// ---------------------------------------------------------------------------
// Regression: an event created without a hold could never acquire one.
//
// `updateEvent` only built its reservation params when BOTH reservation times
// arrived, and `event-service.update()` then ignored them unless the event
// already had a `reservationId`. Between the two, "Reserve practice space" on
// the edit form was unreachable — which is why production accumulated a whole
// calendar of events holding no space, with no way to repair any of them.
//
// This is the same silent no-op shape that events-reserve-space.remote.spec.ts
// pins on the create side: the reservation times are an optional override for
// setup and teardown, not a precondition.
// ---------------------------------------------------------------------------

const eventServiceMock = {
	create: vi.fn(async (_params: any) => ({ id: 'event-1' })),
	update: vi.fn(async (_id: string, _params: any) => ({ id: 'event-1' })),
	checkRebookNeeded: vi.fn(),
	publish: vi.fn(),
	unpublish: vi.fn(),
	unpublishWithNotice: vi.fn(),
	cancel: vi.fn(),
	remove: vi.fn(),
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
		url: new URL('http://localhost/staff/events/event-1'),
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

const { updateEvent } = (await import('$lib/remote/events.remote')) as any;

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

/** The reservation params handed to event-service.update() on the last call. */
function lastRebook() {
	const calls = eventServiceMock.update.mock.calls;
	return (calls[calls.length - 1][1] as any).rebook;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('updateEvent — reserve space', () => {
	const base = {
		eventId: 'event-1',
		title: 'Basement Show',
		eventDate: '2026-08-15',
		eventStartTime: '19:00',
		eventEndTime: '22:00',
		rebookReservation: false,
		overrideConflicts: false
	};

	it('holds the event window when no reservation times are supplied', async () => {
		await updateEvent({ ...base, rebookReservation: true });

		const rebook = lastRebook();
		expect(inClubTime(rebook.reservationStartsAt)).toBe('2026-08-15 19:00');
		expect(inClubTime(rebook.reservationEndsAt)).toBe('2026-08-15 22:00');
	});

	// Falling back per-field would pair a supplied start with a defaulted end, and
	// buildTimeRangeInTz reads an end before the start as an overnight range — a
	// 23:00 start against the event's 22:00 end rolls onto the next day and holds
	// the room for 23 hours. Half a window is no window.
	it('holds the event window when only one reservation time is supplied', async () => {
		await updateEvent({ ...base, rebookReservation: true, reservationStartTime: '23:00' });

		const rebook = lastRebook();
		expect(inClubTime(rebook.reservationStartsAt)).toBe('2026-08-15 19:00');
		expect(inClubTime(rebook.reservationEndsAt)).toBe('2026-08-15 22:00');
	});

	it('prefers the supplied setup/teardown window over the event times', async () => {
		await updateEvent({
			...base,
			rebookReservation: true,
			reservationStartTime: '17:00',
			reservationEndTime: '23:30'
		});

		const rebook = lastRebook();
		expect(inClubTime(rebook.reservationStartsAt)).toBe('2026-08-15 17:00');
		expect(inClubTime(rebook.reservationEndsAt)).toBe('2026-08-15 23:30');
	});

	it('carries the conflict override through to the service', async () => {
		await updateEvent({ ...base, rebookReservation: true, overrideConflicts: true });

		expect(lastRebook().overrideConflicts).toBe(true);
	});

	it('books nothing when the box is left unchecked', async () => {
		await updateEvent(base);

		expect(lastRebook()).toBeUndefined();
	});
});
