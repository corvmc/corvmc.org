import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockUser } from '$lib/server/db/test-factory';

// ---------------------------------------------------------------------------
// Listing writes take `event.manage` or the show's committee (#1948), through
// the real `requireListingWriter`. What is faked is who holds what: a staffer
// holds `event.manage`, a booker holds `production.book` only through a seat on
// the show's project, and an outsider holds neither.
// ---------------------------------------------------------------------------

type Persona = 'staff' | 'booker' | 'outsider';
let persona: Persona = 'staff';

const denied = (msg = 'Not permitted') => Object.assign(new Error(`403: ${msg}`), { status: 403 });

vi.mock('$lib/server/authorization', () => ({
	can: vi.fn(async (cap: string) => persona === 'staff' && cap === 'event.manage'),
	requireCapability: vi.fn(async () => {
		if (persona !== 'staff') throw denied();
		return mockUser({ id: 'staff-1' });
	}),
	requireUser: vi.fn(() => mockUser({ id: `${persona}-1` }))
}));

const requireProjectCommittee = vi.fn(async (projectId: string | null, cap: string) => {
	if (persona === 'booker' && projectId === 'proj-show' && cap === 'production.book') {
		return { user: mockUser({ id: 'booker-1' }), groups: [], via: 'committee' };
	}
	throw denied('Not on a committee taking part in this project');
});
vi.mock('$lib/server/group/group-context', () => ({
	requireProjectCommittee: (projectId: string | null, cap: string) =>
		requireProjectCommittee(projectId, cap)
}));

/** `evt-show` announces a production; `evt-gig` is a listing with none. */
vi.mock('$lib/server/production/production-scope', () => ({
	projectOfEvent: vi.fn(async (id: string) =>
		id === 'evt-show'
			? { projectId: 'proj-show', productionId: 'prod-1' }
			: { projectId: null, productionId: null }
	)
}));

const update = vi.fn(async () => ({ id: 'evt' }));
const setEventLineup = vi.fn(async () => undefined);
vi.mock('$lib/server/event/event-service', () => ({
	update: (...a: unknown[]) => update(...(a as [])),
	getById: vi.fn(async (id: string) => ({
		id,
		source: id === 'evt-show' ? 'cmc' : 'band',
		startsAt: new Date('2026-11-14T03:00:00Z'),
		reservationId: id === 'evt-unheld' ? null : 'res-1'
	})),
	setEventLineup: (...a: unknown[]) => setEventLineup(...(a as [])),
	listAll: vi.fn(),
	listStaffCalendar: vi.fn(),
	listEventsNear: vi.fn(),
	getEventLineup: vi.fn(async () => []),
	listUpcoming: vi.fn(),
	listPast: vi.fn(),
	getShowTonight: vi.fn(),
	listPublicUpcomingEvents: vi.fn(),
	listPublicCalendarEvents: vi.fn()
}));

const cancelSeries = vi.fn(async () => undefined);
const createEventSeries = vi.fn(async () => ({ id: 'series-new' }));
let seriesOfEvent: { id: string } | null = { id: 'series-1' };
vi.mock('$lib/server/reservation/recurring-series-service', () => ({
	createEventSeries: (...a: unknown[]) => createEventSeries(...(a as [])),
	getByEvent: vi.fn(async () => seriesOfEvent),
	getEventSeries: vi.fn(async () => null),
	cancel: (...a: unknown[]) => cancelSeries(...(a as []))
}));

vi.mock('$lib/server/feature-flags', () => ({
	isFeatureEnabled: vi.fn(async () => true),
	requireFeature: vi.fn(async () => undefined)
}));

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		locals: { user: mockUser({ id: 'staff-1' }) },
		url: new URL('http://localhost/staff/events/evt-show'),
		request: { headers: new Headers() }
	}),
	command: (_schema: unknown, handler: (...args: any[]) => any) => {
		(handler as any).__ = { type: 'command' };
		return handler;
	},
	form: (_schema: unknown, handler: (...args: any[]) => any) => {
		(handler as any).__ = { type: 'form' };
		(handler as any).for = () => handler;
		(handler as any).fields = {};
		return handler;
	},
	// Inert: the writes end by refreshing the page query, which needs a database.
	query: () => {
		const inert = () => ({ refresh: () => undefined });
		(inert as any).__ = { type: 'query' };
		return inert;
	}
}));

const { updateEvent, cancelEventSeries, startEventSeries, setStaffEventLineup, adjustListingHold } =
	(await import('$lib/remote/events.remote')) as any;

const EDIT = { title: 'Retitled', rebookReservation: false, overrideConflicts: false };

beforeEach(() => {
	vi.clearAllMocks();
	persona = 'staff';
	seriesOfEvent = { id: 'series-1' };
});

describe('updateEvent', () => {
	it("lets the show's committee edit its listing", async () => {
		persona = 'booker';
		await updateEvent({ eventId: 'evt-show', ...EDIT });
		expect(update).toHaveBeenCalledWith('evt-show', expect.objectContaining({ title: 'Retitled' }));
	});

	it('refuses someone off the committee, writing nothing', async () => {
		persona = 'outsider';
		await expect(updateEvent({ eventId: 'evt-show', ...EDIT })).rejects.toMatchObject({
			status: 403
		});
		expect(update).not.toHaveBeenCalled();
	});

	// The committee's reach is its show. A listing with no production has none.
	it('refuses a booker on a listing with no production', async () => {
		persona = 'booker';
		await expect(updateEvent({ eventId: 'evt-gig', ...EDIT })).rejects.toMatchObject({
			status: 403
		});
		expect(requireProjectCommittee).not.toHaveBeenCalled();
		expect(update).not.toHaveBeenCalled();
	});

	it('lets event.manage edit any listing', async () => {
		await updateEvent({ eventId: 'evt-gig', ...EDIT });
		expect(update).toHaveBeenCalledTimes(1);
	});

	it("books a moved hold in the committee member's name", async () => {
		persona = 'booker';
		await updateEvent({
			eventId: 'evt-show',
			eventDate: '2026-11-01',
			eventStartTime: '19:00',
			eventEndTime: '22:00',
			rebookReservation: true,
			overrideConflicts: false
		});
		const params = (update.mock.calls[0] as unknown[])[1] as { rebook?: { userId: string } };
		expect(params.rebook?.userId).toBe('booker-1');
	});
});

describe('cancelEventSeries', () => {
	it("lets the show's committee stop the series the listing belongs to", async () => {
		persona = 'booker';
		await cancelEventSeries({ eventId: 'evt-show' });
		expect(cancelSeries).toHaveBeenCalledWith(
			'series-1',
			expect.objectContaining({ kind: 'staff' })
		);
	});

	it('refuses someone off the committee, cancelling nothing', async () => {
		persona = 'outsider';
		await expect(cancelEventSeries({ eventId: 'evt-show' })).rejects.toMatchObject({
			status: 403
		});
		expect(cancelSeries).not.toHaveBeenCalled();
	});

	it('answers 404 for a listing that is not part of a series', async () => {
		seriesOfEvent = null;
		await expect(cancelEventSeries({ eventId: 'evt-gig' })).rejects.toMatchObject({
			status: 404
		});
		expect(cancelSeries).not.toHaveBeenCalled();
	});
});

describe('startEventSeries', () => {
	const REPEAT = { eventId: 'evt-show', recurringFrequency: 'weekly' };

	it("lets the show's committee make its listing repeat", async () => {
		persona = 'booker';
		await startEventSeries(REPEAT);
		expect(createEventSeries).toHaveBeenCalledWith(
			expect.objectContaining({ prototypeEventId: 'evt-show', frequency: 'weekly' })
		);
	});

	it('refuses someone off the committee, starting nothing', async () => {
		persona = 'outsider';
		await expect(startEventSeries(REPEAT)).rejects.toMatchObject({ status: 403 });
		expect(createEventSeries).not.toHaveBeenCalled();
	});
});

describe('setStaffEventLineup', () => {
	const BILL = JSON.stringify([{ name: 'Paper Wolves', billingOrder: 0 }]);

	it("lets the show's committee set the bill", async () => {
		persona = 'booker';
		await setStaffEventLineup({ eventId: 'evt-show', lineup: BILL });
		expect(setEventLineup).toHaveBeenCalledTimes(1);
	});

	it('refuses someone off the committee', async () => {
		persona = 'outsider';
		await expect(setStaffEventLineup({ eventId: 'evt-show', lineup: BILL })).rejects.toMatchObject({
			status: 403
		});
		expect(setEventLineup).not.toHaveBeenCalled();
	});
});

// The hold's own window, apart from the show's: setup and teardown.
describe('adjustListingHold', () => {
	const HOLD = {
		eventId: 'evt-show',
		startTime: '17:00',
		endTime: '23:30',
		overrideConflicts: false
	};

	it("moves the hold in place, on the show's club date", async () => {
		persona = 'booker';
		await adjustListingHold(HOLD);
		const params = (update.mock.calls[0] as unknown[])[1] as {
			rebook?: { reservationStartsAt: Date; reservationEndsAt: Date; userId: string };
			startsAt?: Date;
		};
		// 2026-11-14T03:00Z is the 13th in Pacific time; 17:00 PST is 01:00Z on the 14th.
		expect(params.rebook?.reservationStartsAt.toISOString()).toBe('2026-11-14T01:00:00.000Z');
		expect(params.rebook?.reservationEndsAt.toISOString()).toBe('2026-11-14T07:30:00.000Z');
		expect(params.rebook?.userId).toBe('booker-1');
		expect(params.startsAt).toBeUndefined();
	});

	it('refuses someone off the committee, moving nothing', async () => {
		persona = 'outsider';
		await expect(adjustListingHold(HOLD)).rejects.toMatchObject({ status: 403 });
		expect(update).not.toHaveBeenCalled();
	});

	it('answers 404 for a listing with no hold', async () => {
		await expect(adjustListingHold({ ...HOLD, eventId: 'evt-unheld' })).rejects.toMatchObject({
			status: 404
		});
		expect(update).not.toHaveBeenCalled();
	});
});
