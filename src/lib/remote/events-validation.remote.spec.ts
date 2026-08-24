import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isValidationError } from '@sveltejs/kit';

// Regression: these handlers called `issue.field('message')` on their own. That
// only *constructs* an issue object — it is `invalid()` (from `@sveltejs/kit`)
// that throws it. Without the throw the check was a silent no-op: execution fell
// straight through into the service layer, so a non-numeric quantity or a blank
// guest name reached the ticket service and surfaced as a 500 "Internal Error"
// instead of a field-level form error.
//
// These tests pin the rejection: the handler must throw a validation error and
// must not call the service.

const createTickets = vi.fn(async () => [{ id: 'ticket-1' }]);
const getTicketsRemaining = vi.fn(async () => null);
const checkIn = vi.fn();
const cancelTicket = vi.fn();

vi.mock('$lib/server/ticket/ticket-service', () => ({
	getTicketsRemaining: (...a: unknown[]) => getTicketsRemaining(...(a as [])),
	getTicketsSold: vi.fn(),
	getEventTickets: vi.fn(),
	getUserTickets: vi.fn(),
	getTicketsByPurchase: vi.fn(),
	createTickets: (...a: unknown[]) => createTickets(...(a as [])),
	checkIn: (...a: unknown[]) => checkIn(...a),
	cancelTicket: (...a: unknown[]) => cancelTicket(...a)
}));

const createRsvp = vi.fn(async () => ({ id: 'rsvp-1' }));
vi.mock('$lib/server/event/rsvp-service', () => ({
	createRsvp: (...a: unknown[]) => createRsvp(...(a as [])),
	cancelRsvp: vi.fn(),
	getUserRsvp: vi.fn(),
	countRsvps: vi.fn(async () => 0)
}));

const checkout = vi.fn(async () => ({ url: 'https://stripe.test/session' }));
// Must be the same class the handler's `instanceof` compares against, so the
// module is mocked rather than the real error imported alongside it.
class InsufficientCreditsError extends Error {}
vi.mock('$lib/server/finance/credit-service', () => ({ InsufficientCreditsError }));
vi.mock('$lib/server/finance/payment-service', () => ({
	checkout: (...a: unknown[]) => checkout(...(a as []))
}));

// A published, ticketed event — so the only thing that can reject the submission
// is the field validation under test, not the event's own state.
const getById = vi.fn(
	async (
		id: string
	): Promise<{
		id: string;
		title: string;
		status: string;
		ticketingEnabled: boolean;
		ticketPrice: number | null;
		externalTicketUrl?: string | null;
	}> => ({
		id,
		title: 'Open Mic Night',
		status: 'published',
		ticketingEnabled: true,
		ticketPrice: 1500
	})
);

vi.mock('$lib/server/event/event-service', () => ({
	create: vi.fn(),
	update: vi.fn(),
	checkRebookNeeded: vi.fn(),
	publish: vi.fn(),
	unpublish: vi.fn(),
	cancel: vi.fn(),
	getById: (...a: unknown[]) => getById(...(a as [string])),
	listAll: vi.fn(),
	listUpcoming: vi.fn(),
	listPast: vi.fn()
}));

vi.mock('$lib/server/authorization', () => ({
	requireStaff: vi.fn(async () => ({ id: 'staff-1' })),
	requireUser: vi.fn(async () => ({ id: 'user-1' }))
}));

vi.mock('$lib/server/reservation/conflict-service', () => ({
	getConflictDetails: vi.fn(),
	getValidationWarnings: vi.fn()
}));
vi.mock('$lib/server/reservation/recurring-series-service', () => ({
	createEventSeries: vi.fn(),
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
vi.mock('$lib/server/storage', () => ({ resolveImageUrl: vi.fn() }));
vi.mock('$lib/server/feature-flags', () => ({
	isFeatureEnabled: vi.fn(async () => true),
	requireFeature: vi.fn(async () => undefined)
}));
vi.mock('$lib/server/db', () => ({ db: {} }));

// Guest submission — no logged-in account to fall back on for name/email.
vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		locals: { user: null },
		url: new URL('http://localhost/'),
		request: { headers: new Headers() }
	}),
	// The remote-function plugin validates that every export of a `.remote.ts`
	// module is a tagged remote function, so the stubs have to carry the marker.
	query: (...args: unknown[]) => tag(args, 'query'),
	command: (...args: unknown[]) => tag(args, 'command'),
	form: (...args: unknown[]) => tag(args, 'form')
}));

function tag(args: unknown[], type: string) {
	const handler = (typeof args[0] === 'function' ? args[0] : args[1]) as Record<string, unknown>;
	handler.__ = { type };
	handler.for = () => handler;
	return handler;
}

const events = (await import('./events.remote')) as unknown as Record<
	string,
	(data: unknown, issue: unknown) => Promise<unknown>
>;

const conflictService = (await import('$lib/server/reservation/conflict-service')) as unknown as {
	getConflictDetails: ReturnType<typeof vi.fn>;
	getValidationWarnings: ReturnType<typeof vi.fn>;
};

// Mirrors SvelteKit's `issue` helper: `issue.field(msg)` builds an issue object
// carrying the field path. It does not throw on its own — that is the whole point.
function makeIssue() {
	return new Proxy(
		{},
		{
			get: (_t, field: string) => (message: string) => ({ message, path: [field] })
		}
	);
}

async function expectRejects(fn: () => Promise<unknown>, field: string) {
	let thrown: unknown;
	try {
		await fn();
	} catch (e) {
		thrown = e;
	}
	expect(isValidationError(thrown)).toBe(true);
	const issues = (thrown as { issues: Array<{ path: string[]; message: string }> }).issues;
	expect(issues.some((i) => i.path?.includes(field))).toBe(true);
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('compTickets validation', () => {
	// `quantity` is `z.string().transform(Number)`, so the schema happily produces
	// NaN — the handler's range check is the only thing standing between a typo
	// and a ticket row with a NaN quantity.
	it('rejects a non-numeric quantity without creating tickets', async () => {
		await expectRejects(
			() =>
				events.compTickets(
					{
						eventId: 'evt-1',
						attendeeName: 'Ada',
						attendeeEmail: 'ada@example.com',
						quantity: NaN
					},
					makeIssue()
				),
			'quantity'
		);
		expect(createTickets).not.toHaveBeenCalled();
	});

	it('rejects a quantity above the comp limit without creating tickets', async () => {
		await expectRejects(
			() =>
				events.compTickets(
					{
						eventId: 'evt-1',
						attendeeName: 'Ada',
						attendeeEmail: 'ada@example.com',
						quantity: 51
					},
					makeIssue()
				),
			'quantity'
		);
		expect(createTickets).not.toHaveBeenCalled();
	});
});

describe('claimFreeTicket validation', () => {
	// `attendeeName`/`attendeeEmail` are optional in the schema because logged-in
	// members fall back to their account. A guest leaving them blank must still be
	// rejected rather than booked in with an empty name.
	it('rejects a guest with no name or email without creating an RSVP', async () => {
		await expectRejects(
			() => events.claimFreeTicket({ eventId: 'evt-1', quantity: 1 }, makeIssue()),
			'attendeeName'
		);
		expect(createRsvp).not.toHaveBeenCalled();
	});

	it('rejects a malformed email without creating an RSVP', async () => {
		await expectRejects(
			() =>
				events.claimFreeTicket(
					{ eventId: 'evt-1', quantity: 1, attendeeName: 'Ada', attendeeEmail: 'not-an-email' },
					makeIssue()
				),
			'attendeeEmail'
		);
		expect(createRsvp).not.toHaveBeenCalled();
	});

	it('rejects a non-numeric quantity without creating an RSVP', async () => {
		await expectRejects(
			() =>
				events.claimFreeTicket(
					{
						eventId: 'evt-1',
						quantity: NaN,
						attendeeName: 'Ada',
						attendeeEmail: 'ada@example.com'
					},
					makeIssue()
				),
			'quantity'
		);
		expect(createRsvp).not.toHaveBeenCalled();
	});

	// One submission can be wrong in more than one way; the form should surface
	// every bad field at once rather than making the user fix them one at a time.
	it('reports quantity and attendee issues together', async () => {
		let thrown: unknown;
		try {
			await events.claimFreeTicket({ eventId: 'evt-1', quantity: NaN }, makeIssue());
		} catch (e) {
			thrown = e;
		}
		const issues = (thrown as { issues: Array<{ path: string[] }> }).issues;
		const fields = issues.flatMap((i) => i.path ?? []);
		expect(fields).toEqual(expect.arrayContaining(['quantity', 'attendeeName', 'attendeeEmail']));
	});
});

describe('purchaseTickets validation', () => {
	it('rejects a non-numeric quantity without starting a checkout', async () => {
		await expectRejects(
			() =>
				events.purchaseTickets(
					{
						eventId: 'evt-1',
						quantity: NaN,
						attendeeName: 'Ada',
						attendeeEmail: 'ada@example.com'
					},
					makeIssue()
				),
			'quantity'
		);
		expect(checkout).not.toHaveBeenCalled();
	});

	it('rejects a guest with no name or email without starting a checkout', async () => {
		await expectRejects(
			() => events.purchaseTickets({ eventId: 'evt-1', quantity: 2 }, makeIssue()),
			'attendeeName'
		);
		expect(checkout).not.toHaveBeenCalled();
	});

	/**
	 * checkout() spends credits before charging, and payment-service reverses
	 * every completed deduction if a later one fails — so this can only be a lost
	 * race, with nothing charged. It used to propagate as an unhandled throw: a
	 * 500 in Sentry for a routine race, and a generic "Something went wrong" for
	 * the buyer, since Form drops the message off a thrown error.
	 */
	it('turns a lost credit race into a quantity issue rather than an unhandled throw', async () => {
		// The shared getById default omits `source`, which trips the "not ours to
		// sell" guard long before checkout — override it so this test reaches the
		// code it is actually about.
		getById.mockResolvedValueOnce({
			id: 'evt-1',
			title: 'Open Mic Night',
			status: 'published',
			ticketingEnabled: true,
			ticketPrice: 1500,
			source: 'cmc'
		} as never);
		checkout.mockRejectedValueOnce(new InsufficientCreditsError('raced'));

		await expectRejects(
			() =>
				events.purchaseTickets(
					{
						eventId: 'evt-1',
						quantity: 2,
						attendeeName: 'Ada',
						attendeeEmail: 'ada@example.com'
					},
					makeIssue()
				),
			'quantity'
		);
		// Guards the test itself: the assertion above passes for any validation
		// rejection, including ones that fire long before the code under test.
		expect(checkout).toHaveBeenCalled();
	});
});

// Regression: an externally ticketed event is not one we sell, so it belongs on
// the lightweight RSVP path — the ticket comes from the outside seller and all we
// record is who's coming. Only OUR checkout (`ticketingEnabled`) is disqualifying.
describe('rsvpToEvent with external ticketing', () => {
	const attendee = { attendeeName: 'Ada', attendeeEmail: 'ada@example.com' };

	it('accepts an RSVP for an event sold off-site', async () => {
		getById.mockResolvedValueOnce({
			id: 'evt-1',
			title: 'Gig at the Whiteside',
			status: 'published',
			ticketingEnabled: false,
			ticketPrice: 1800,
			externalTicketUrl: 'https://venue.test/tickets'
		});

		await events.rsvpToEvent({ eventId: 'evt-1', ...attendee }, makeIssue());

		expect(createRsvp).toHaveBeenCalledWith(
			expect.objectContaining({ eventId: 'evt-1', ...attendee })
		);
	});

	it('accepts an RSVP for a door-price event', async () => {
		getById.mockResolvedValueOnce({
			id: 'evt-1',
			title: 'Open Jam',
			status: 'published',
			ticketingEnabled: false,
			ticketPrice: 1000,
			externalTicketUrl: null
		});

		await events.rsvpToEvent({ eventId: 'evt-1', ...attendee }, makeIssue());

		expect(createRsvp).toHaveBeenCalledOnce();
	});

	it('still refuses an RSVP for an event we ticket ourselves', async () => {
		// getById's default mock is a platform-ticketed event.
		await expect(
			events.rsvpToEvent({ eventId: 'evt-1', ...attendee }, makeIssue())
		).rejects.toThrow();
		expect(createRsvp).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// Regression: `checkConflicts` filtered the event's own hold with
// `!('id' in c)`, but getConflictDetails never selected an id, so the predicate
// was always true and nothing was ever dropped. Re-timing an event reported its
// own reservation as a conflict, which armed "Override conflicts" on the form —
// and saving with that set made the server skip the real double-booking check.
// ---------------------------------------------------------------------------

describe('checkConflicts — excludeReservationId', () => {
	const window = { date: '2026-08-15', startTime: '19:00', endTime: '22:00' };

	function detail(id: string, label: string) {
		return {
			type: 'reservation' as const,
			id,
			startsAt: new Date('2026-08-15T02:00:00Z'),
			endsAt: new Date('2026-08-16T05:00:00Z'),
			label
		};
	}

	beforeEach(() => {
		conflictService.getValidationWarnings.mockResolvedValue([]);
	});

	it("drops the event's own hold and keeps everyone else's", async () => {
		conflictService.getConflictDetails.mockResolvedValue([
			detail('own-hold', 'Front Desk'),
			detail('someone-else', 'A Member')
		]);

		const result = (await events.checkConflicts(
			{ ...window, excludeReservationId: 'own-hold' },
			undefined
		)) as { conflicts: Array<{ id?: string }> };

		expect(result.conflicts.map((c) => c.id)).toEqual(['someone-else']);
	});

	it('keeps closures, which carry no id to match on', async () => {
		conflictService.getConflictDetails.mockResolvedValue([
			detail('own-hold', 'Front Desk'),
			{
				type: 'closure' as const,
				startsAt: new Date('2026-08-15T02:00:00Z'),
				endsAt: new Date('2026-08-16T05:00:00Z'),
				label: 'HVAC replacement'
			}
		]);

		const result = (await events.checkConflicts(
			{ ...window, excludeReservationId: 'own-hold' },
			undefined
		)) as { conflicts: Array<{ type: string }> };

		expect(result.conflicts.map((c) => c.type)).toEqual(['closure']);
	});

	it('keeps every conflict when nothing is excluded', async () => {
		conflictService.getConflictDetails.mockResolvedValue([detail('a', 'One'), detail('b', 'Two')]);

		const result = (await events.checkConflicts(window, undefined)) as {
			conflicts: Array<{ id?: string }>;
		};

		expect(result.conflicts.map((c) => c.id)).toEqual(['a', 'b']);
	});
});
