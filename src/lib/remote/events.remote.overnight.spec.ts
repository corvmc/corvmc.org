import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockUser } from '$lib/server/db/test-factory';

// ---------------------------------------------------------------------------
// Regression: a show that runs past midnight (9 PM – 1 AM) is entered as one
// date plus a start and an end time. Both instants were anchored to that one
// date, so `endsAt` landed eight hours BEFORE `startsAt` and every save — of any
// field, not just the times — died on the event table's `event_time_order`
// CHECK constraint as a 500.
//
// The real timezone helpers are used deliberately: the rollover lives there.
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

const { createEvent, updateEvent } = (await import('$lib/remote/events.remote')) as any;

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

describe('updateEvent — event crossing midnight', () => {
	const base = {
		eventId: 'event-1',
		title: 'Late Set',
		eventDate: '2026-08-15',
		eventStartTime: '21:00',
		eventEndTime: '01:00',
		rebookReservation: false,
		overrideConflicts: false
	};

	it('ends the event on the following day', async () => {
		await updateEvent(base, issue);

		const params = eventServiceMock.update.mock.calls[0][1];
		expect(inClubTime(params.startsAt)).toBe('2026-08-15 21:00');
		expect(inClubTime(params.endsAt)).toBe('2026-08-16 01:00');
		expect(params.endsAt.getTime()).toBeGreaterThan(params.startsAt.getTime());
	});

	it('rolls the rebooked reservation past midnight too', async () => {
		await updateEvent(
			{
				...base,
				rebookReservation: true,
				reservationStartTime: '20:00',
				reservationEndTime: '02:00'
			},
			issue
		);

		const { rebook } = eventServiceMock.update.mock.calls[0][1];
		expect(inClubTime(rebook.reservationStartsAt)).toBe('2026-08-15 20:00');
		expect(inClubTime(rebook.reservationEndsAt)).toBe('2026-08-16 02:00');
	});

	it('leaves a same-day event on its own day', async () => {
		await updateEvent({ ...base, eventStartTime: '19:00', eventEndTime: '22:00' }, issue);

		const params = eventServiceMock.update.mock.calls[0][1];
		expect(inClubTime(params.endsAt)).toBe('2026-08-15 22:00');
	});
});

describe('createEvent — event crossing midnight', () => {
	const base = {
		title: 'Late Set',
		eventDate: '2026-08-15',
		eventStartTime: '21:00',
		eventEndTime: '01:00',
		ticketingEnabled: false,
		reserveSpace: false,
		overrideConflicts: false,
		recurring: false
	};

	it('ends the event on the following day', async () => {
		await createEvent(base, issue);

		const params = eventServiceMock.create.mock.calls[0][0];
		expect(inClubTime(params.startsAt)).toBe('2026-08-15 21:00');
		expect(inClubTime(params.endsAt)).toBe('2026-08-16 01:00');
	});

	it('rolls the held reservation past midnight too', async () => {
		await createEvent(
			{
				...base,
				reserveSpace: true,
				reservationStartTime: '20:00',
				reservationEndTime: '02:00'
			},
			issue
		);

		const { reservation } = eventServiceMock.create.mock.calls[0][0];
		expect(inClubTime(reservation.startsAt)).toBe('2026-08-15 20:00');
		expect(inClubTime(reservation.endsAt)).toBe('2026-08-16 02:00');
	});
});
