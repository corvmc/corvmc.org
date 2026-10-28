import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockUser } from '$lib/server/db/test-factory';

// ---------------------------------------------------------------------------
// The show's committee reads what it may write (#2002): the listing page, and
// the RSVP roster and CSV, through the real guards. What is faked is who holds
// what, as in `events.remote.listing-guard.spec.ts`.
// ---------------------------------------------------------------------------

type Persona = 'staff' | 'reader' | 'booker' | 'outsider';
let persona: Persona = 'staff';

const denied = (msg = 'Not permitted') => Object.assign(new Error(`403: ${msg}`), { status: 403 });

const held: Record<Persona, string[]> = {
	staff: ['event.read', 'event.manage'],
	reader: ['event.read'],
	booker: [],
	outsider: []
};

vi.mock('$lib/server/authorization', () => ({
	can: vi.fn(async (cap: string) => held[persona].includes(cap)),
	requireCapability: vi.fn(async (cap: string) => {
		if (!held[persona].includes(cap)) throw denied();
		return mockUser({ id: `${persona}-1` });
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

// No listing exists past the guard, so a caller the guard admits gets a 404
// and one it refuses gets a 403: the status says which side of the guard it was.
const getById = vi.fn(async (): Promise<null | { id: string; title: string }> => null);
vi.mock('$lib/server/event/event-service', () => ({
	getById: () => getById(),
	update: vi.fn(),
	setEventLineup: vi.fn(),
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

const getByEvent = vi.fn(async () => null);
vi.mock('$lib/server/reservation/recurring-series-service', () => ({
	createEventSeries: vi.fn(),
	getByEvent: () => getByEvent(),
	getEventSeries: vi.fn(async () => null),
	cancel: vi.fn()
}));

const listRsvpsForEvent = vi.fn(async () => [
	{ id: 'r1', userId: 'u1', name: 'Ada', email: 'ada@example.com', createdAt: new Date(0) }
]);
vi.mock('$lib/server/event/rsvp-service', () => ({
	listRsvpsForEvent: () => listRsvpsForEvent(),
	cancelRsvp: vi.fn(),
	createRsvp: vi.fn(),
	getUserRsvp: vi.fn()
}));

vi.mock('$lib/server/feature-flags', () => ({
	isFeatureEnabled: vi.fn(async () => true),
	requireFeature: vi.fn(async () => undefined)
}));

vi.mock('$app/server', () => {
	const tag = (type: string) => (handler: (...args: any[]) => any) => {
		(handler as any).__ = { type };
		(handler as any).refresh = () => undefined;
		(handler as any).for = () => handler;
		(handler as any).fields = {};
		return handler;
	};
	return {
		getRequestEvent: () => ({
			locals: { user: mockUser({ id: 'staff-1' }) },
			url: new URL('http://localhost/staff/events/evt-show'),
			request: { headers: new Headers() }
		}),
		command: (_s: unknown, h: (...args: any[]) => any) => tag('command')(h),
		form: (_s: unknown, h: (...args: any[]) => any) => tag('form')(h),
		// Real handlers, so a query runs its own guard. A bare `query(fn)` has no schema.
		query: (a: unknown, b?: (...args: any[]) => any) =>
			tag('query')((b ?? a) as (...args: any[]) => any)
	};
});

const { getStaffEventPage, getStaffEventDetail, getEventRecurringSeries } =
	(await import('$lib/remote/events.remote')) as any;
const { getEventRsvpRoster } = (await import('$lib/remote/event-rsvp.remote')) as any;
const { GET: rsvpCsv } = await import('../../routes/staff/events/[id]/rsvps.csv/+server');

const csv = (id: string) => rsvpCsv({ params: { id } } as never) as Promise<Response>;

beforeEach(() => {
	vi.clearAllMocks();
	persona = 'staff';
	getById.mockResolvedValue(null);
});

describe.each([
	['getStaffEventPage', () => getStaffEventPage],
	['getStaffEventDetail', () => getStaffEventDetail]
])('%s', (_name, fn) => {
	it("lets the show's committee past the guard", async () => {
		persona = 'booker';
		await expect(fn()('evt-show')).rejects.toMatchObject({ status: 404 });
	});

	it('still lets an event.read staffer past the guard', async () => {
		persona = 'reader';
		await expect(fn()('evt-gig')).rejects.toMatchObject({ status: 404 });
	});

	it('refuses someone off the committee', async () => {
		persona = 'outsider';
		await expect(fn()('evt-show')).rejects.toMatchObject({ status: 403 });
		expect(getById).not.toHaveBeenCalled();
	});

	it('refuses a booker on a listing with no production', async () => {
		persona = 'booker';
		await expect(fn()('evt-gig')).rejects.toMatchObject({ status: 403 });
		expect(requireProjectCommittee).not.toHaveBeenCalled();
	});
});

describe('getEventRecurringSeries', () => {
	it("answers the show's committee", async () => {
		persona = 'booker';
		await expect(getEventRecurringSeries('evt-show')).resolves.toBeNull();
		expect(getByEvent).toHaveBeenCalled();
	});

	it('refuses someone off the committee', async () => {
		persona = 'outsider';
		await expect(getEventRecurringSeries('evt-show')).rejects.toMatchObject({ status: 403 });
	});
});

describe('getEventRsvpRoster', () => {
	it("gives the show's committee the full roster, emails included", async () => {
		persona = 'booker';
		const roster = await getEventRsvpRoster('evt-show');
		expect(roster).toMatchObject({ total: 1, rows: [{ contact: 'ada@example.com' }] });
	});

	it('hides it from someone off the committee, reading nothing', async () => {
		persona = 'outsider';
		await expect(getEventRsvpRoster('evt-show')).resolves.toBeNull();
		expect(listRsvpsForEvent).not.toHaveBeenCalled();
	});

	it('hides it from a booker on a listing with no production', async () => {
		persona = 'booker';
		await expect(getEventRsvpRoster('evt-gig')).resolves.toBeNull();
		expect(listRsvpsForEvent).not.toHaveBeenCalled();
	});
});

describe('GET rsvps.csv', () => {
	beforeEach(() => {
		getById.mockResolvedValue({ id: 'evt-show', title: 'A show' });
	});

	it("downloads for the show's committee", async () => {
		persona = 'booker';
		const res = await csv('evt-show');
		expect(await res.text()).toContain('Ada,ada@example.com');
	});

	it('403s someone off the committee', async () => {
		persona = 'outsider';
		await expect(csv('evt-show')).rejects.toMatchObject({ status: 403 });
		expect(listRsvpsForEvent).not.toHaveBeenCalled();
	});

	it('403s a booker on a listing with no production', async () => {
		persona = 'booker';
		await expect(csv('evt-gig')).rejects.toMatchObject({ status: 403 });
		expect(listRsvpsForEvent).not.toHaveBeenCalled();
	});
});
