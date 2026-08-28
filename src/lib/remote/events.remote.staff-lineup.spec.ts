import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockUser } from '$lib/server/db/test-factory';

// ---------------------------------------------------------------------------
// `setStaffEventLineup` decides one thing, and it is a consent decision.
//
// `setEventLineup` resolves a newly linked act to `confirmed` when `asStaff` is
// set — "staff booked the show, so every act they name is already agreed". That
// holds for a CMC production. It is false for a listing: staff did not book a
// member's show, and confirming on their behalf would put a credit on the named
// band's public profile that the band never agreed to.
//
// So the flag follows `event.source`, and these tests exist because that is a
// one-word difference someone will eventually "simplify" to a constant. The
// service's own status resolution is covered in event-service.lineup.spec.ts;
// what is pinned here is only which flag the remote passes it.
// ---------------------------------------------------------------------------

const setEventLineup = vi.fn(async () => undefined);
let eventRow: Record<string, unknown> | null = null;

vi.mock('$lib/server/event/event-service', () => ({
	getById: vi.fn(async () => eventRow),
	setEventLineup: (...args: unknown[]) => setEventLineup(...(args as [])),
	// Imported at module load by events.remote; unused here.
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

vi.mock('$lib/server/authorization', () => ({
	requireStaff: vi.fn(async () => mockUser({ id: 'staff-1' })),
	requireUser: vi.fn(() => mockUser({ id: 'staff-1' }))
}));

vi.mock('$lib/server/feature-flags', () => ({
	isFeatureEnabled: vi.fn(async () => true),
	requireFeature: vi.fn(async () => undefined)
}));

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		locals: { user: mockUser({ id: 'staff-1' }) },
		url: new URL('http://localhost/staff/events/evt-1'),
		request: { headers: new Headers() }
	}),
	form: (_schema: unknown, handler: (...args: any[]) => any) => {
		(handler as any).__ = { type: 'form' };
		(handler as any).for = () => handler;
		(handler as any).fields = {};
		return handler;
	},
	// Inert on purpose. `setStaffEventLineup` ends with
	// `getStaffEventPage(id).refresh()`, and in this harness `query()` hands back
	// the handler itself — so a faithful mock would run the real page query and
	// reach for a database. Nothing here tests a query, so they return a stub.
	query: () => {
		const inert = () => ({ refresh: () => undefined });
		(inert as any).__ = { type: 'query' };
		return inert;
	}
}));

const { setStaffEventLineup } = (await import('$lib/remote/events.remote')) as any;

const BILL = JSON.stringify([{ name: 'Paper Wolves', bandId: 'band-1', billingOrder: 0 }]);

beforeEach(() => {
	vi.clearAllMocks();
	eventRow = null;
});

describe('setStaffEventLineup', () => {
	it('confirms outright on a show CMC produces', async () => {
		eventRow = { id: 'evt-1', source: 'cmc' };
		await setStaffEventLineup({ eventId: 'evt-1', lineup: BILL });

		expect(setEventLineup).toHaveBeenCalledWith('evt-1', expect.any(Array), { asStaff: true });
	});

	// The one that matters. Staff did not book this show, so a link they make is
	// a claim the named band still gets to answer.
	it('leaves a community listing to the band to confirm', async () => {
		eventRow = { id: 'evt-1', source: 'community' };
		await setStaffEventLineup({ eventId: 'evt-1', lineup: BILL });

		expect(setEventLineup).toHaveBeenCalledWith('evt-1', expect.any(Array), { asStaff: false });
	});

	it('treats a band gig the same way, for the same reason', async () => {
		eventRow = { id: 'evt-1', source: 'band' };
		await setStaffEventLineup({ eventId: 'evt-1', lineup: BILL });

		expect(setEventLineup).toHaveBeenCalledWith('evt-1', expect.any(Array), { asStaff: false });
	});

	it('writes nothing when the field is absent', async () => {
		eventRow = { id: 'evt-1', source: 'cmc' };
		await setStaffEventLineup({ eventId: 'evt-1' });

		expect(setEventLineup).not.toHaveBeenCalled();
	});

	// A malformed field is ignored rather than throwing: the editor posts JSON in
	// a hidden input, and a half-written one must not wipe the bill.
	it('writes nothing when the field will not parse', async () => {
		eventRow = { id: 'evt-1', source: 'cmc' };
		await setStaffEventLineup({ eventId: 'evt-1', lineup: '{not json' });

		expect(setEventLineup).not.toHaveBeenCalled();
	});
});
