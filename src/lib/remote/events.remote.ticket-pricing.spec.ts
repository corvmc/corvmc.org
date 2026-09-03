import { describe, it, expect, vi, beforeEach } from 'vitest';

// What a buyer is actually charged for a ticket, where the money is recorded as
// going, and what the ticket row remembers about it. A scenario slice rather
// than more cases in `events.remote.validation.spec.ts`: that file mocks
// `getRequestEvent` with a guest (`locals.user: null`) on purpose, and these
// need a signed-in buyer behind them.

type TicketArgs = Record<string, unknown>;
const createTickets = vi.fn(async (_opts: TicketArgs) => [{ id: 'ticket-1' }]);
const issueFreeTickets = vi.fn(async (_opts: TicketArgs) => [{ id: 'ticket-1' }]);
const countTicketsForEmail = vi.fn(async (_e: string, _m: string) => 0);
vi.mock('$lib/server/ticket/ticket-service', () => ({
	getTicketsRemaining: vi.fn(async () => null),
	getTicketsSold: vi.fn(),
	getEventTickets: vi.fn(),
	getUserTickets: vi.fn(),
	getTicketsByPurchase: vi.fn(),
	createTickets: (opts: TicketArgs) => createTickets(opts),
	issueFreeTickets: (opts: TicketArgs) => issueFreeTickets(opts),
	countTicketsForEmail: (...a: unknown[]) => countTicketsForEmail(...(a as [string, string])),
	checkIn: vi.fn(),
	cancelTicket: vi.fn()
}));

vi.mock('$lib/server/event/rsvp-service', () => ({
	createRsvp: vi.fn(),
	cancelRsvp: vi.fn(),
	getUserRsvp: vi.fn(),
	countRsvps: vi.fn(async () => 0)
}));

type CheckoutArgs = {
	lineItems: Array<{ key: string; unitAmountCents: number; quantity: number }>;
	metadata: Record<string, string>;
};
const checkout = vi.fn(async (_opts: CheckoutArgs) => ({
	paid: false,
	checkoutUrl: 'https://stripe.test/session'
}));
class InsufficientCreditsError extends Error {}
vi.mock('$lib/server/finance/credit-service', () => ({ InsufficientCreditsError }));
vi.mock('$lib/server/finance/payment-service', () => ({
	checkout: (opts: CheckoutArgs) => checkout(opts)
}));

// Echoes the product key back so a test can name the line item it expects.
const buildLineItem = vi.fn(async (key: string, unitAmountCents: number, quantity: number) => ({
	key,
	unitAmountCents,
	quantity
}));
vi.mock('$lib/server/finance/product-config-service', () => ({
	buildLineItem: (...a: unknown[]) =>
		buildLineItem(...(a as [key: string, unitAmountCents: number, quantity: number]))
}));

const getById = vi.fn(async (id: string) => ({
	id,
	title: 'Open Mic Night',
	status: 'published',
	ticketingEnabled: true,
	ticketPrice: 1500,
	ticketPriceFloorCents: 0,
	source: 'cmc'
}));

const isSustainingMember = vi.fn(async () => false);
vi.mock('$lib/server/finance/subscription-service', () => ({
	isSustainingMember: (...a: unknown[]) => isSustainingMember(...(a as []))
}));

// A published CMC show suggesting $15, with the scale running to free. Tests
// that need a floor override `getById` for themselves.
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
vi.mock('$lib/server/storage', () => ({ resolveImageUrl: vi.fn() }));
vi.mock('$lib/server/feature-flags', () => ({
	isFeatureEnabled: vi.fn(async () => true),
	requireFeature: vi.fn(async () => undefined)
}));
vi.mock('$lib/server/db', () => ({ db: {} }));

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		locals: { user: { id: 'user-1', name: 'Ada', email: 'ada@example.com', stripeId: 'cus_1' } },
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
	return handler;
}

const events = (await import('./events.remote')) as unknown as Record<
	string,
	(data: unknown, issue: unknown) => Promise<unknown>
>;

function makeIssue() {
	return new Proxy(
		{},
		{ get: (_t, field: string) => (message: string) => ({ message, path: [field] }) }
	);
}

function purchase(data: Record<string, unknown>) {
	return events.purchaseTickets(
		{
			eventId: 'evt-1',
			quantity: 1,
			attendeeName: 'Ada',
			attendeeEmail: 'ada@example.com',
			...data
		},
		makeIssue()
	);
}

/** The arguments the handler passed to createTickets. */
function ticketArgs(): TicketArgs {
	return createTickets.mock.calls.at(-1)![0];
}

/** The cart handed to checkout(). */
function lineItems(): CheckoutArgs {
	return checkout.mock.calls.at(-1)![0];
}

beforeEach(() => {
	vi.clearAllMocks();
	isSustainingMember.mockResolvedValue(false);
	countTicketsForEmail.mockResolvedValue(0);
	getById.mockResolvedValue({
		id: 'evt-1',
		title: 'Open Mic Night',
		status: 'published',
		ticketingEnabled: true,
		ticketPrice: 1500,
		ticketPriceFloorCents: 0,
		source: 'cmc'
	});
});

describe('purchaseTickets, on the sliding scale', () => {
	it('charges what the buyer named, and records where they sent it', async () => {
		// $15 × 2 = $30, card takes 117¢, and the collective's suggested position
		// is 30% of what is left. The acts get the remainder, derived.
		await purchase({ quantity: 2, unitPriceCents: 1500, collectiveCents: 866 });

		expect(lineItems().lineItems).toEqual([{ key: 'ticket', unitAmountCents: 1500, quantity: 2 }]);
		expect(ticketArgs()).toMatchObject({
			unitPriceCents: 1500,
			collectiveCents: 866,
			actsCents: 3000 - 866 - 117
		});
	});

	it('charges a sustaining member exactly what it charges anybody else', async () => {
		// The half-price member rate is gone: half off a pay-what-you-can ticket
		// is a discount off a suggestion, which is a discount off nothing.
		isSustainingMember.mockResolvedValue(true);

		await purchase({ quantity: 2, unitPriceCents: 1500, collectiveCents: 0 });

		expect(lineItems().lineItems).toEqual([{ key: 'ticket', unitAmountCents: 1500, quantity: 2 }]);
		expect(ticketArgs()).toMatchObject({ unitPriceCents: 1500 });
	});

	it('sells below the suggestion at the amount the buyer named', async () => {
		await purchase({ unitPriceCents: 500, collectiveCents: 0 });

		expect(lineItems().lineItems).toEqual([{ key: 'ticket', unitAmountCents: 500, quantity: 1 }]);
		expect(ticketArgs()).toMatchObject({ unitPriceCents: 500, contributionCents: 0 });
	});

	it('refuses an allocation that would leave the acts nothing', async () => {
		await expect(purchase({ unitPriceCents: 1500, collectiveCents: 1500 })).rejects.toBeDefined();
		expect(checkout).not.toHaveBeenCalled();
	});

	it('refuses an amount below the show\u2019s floor', async () => {
		getById.mockResolvedValueOnce({
			id: 'evt-1',
			title: 'Open Mic Night',
			status: 'published',
			ticketingEnabled: true,
			ticketPrice: 1500,
			ticketPriceFloorCents: 1000,
			source: 'cmc'
		});

		await expect(purchase({ unitPriceCents: 500, collectiveCents: 0 })).rejects.toBeDefined();
		expect(checkout).not.toHaveBeenCalled();
	});
});

describe('purchaseTickets, above the suggestion', () => {
	it('charges the excess as its own line item, not as a bigger ticket', async () => {
		await purchase({ quantity: 2, unitPriceCents: 2000, collectiveCents: 0 });

		expect(lineItems().lineItems).toEqual([
			{ key: 'ticket', unitAmountCents: 1500, quantity: 2 },
			{ key: 'ticket_contribution', unitAmountCents: 1000, quantity: 1 }
		]);
		expect(ticketArgs()).toMatchObject({ contributionCents: 1000 });
	});

	it('tells the webhook what the contribution was, so the receipt can name it', async () => {
		await purchase({ unitPriceCents: 2500, collectiveCents: 0 });

		expect(lineItems().metadata).toMatchObject({
			ticket_unit_price_cents: '1500',
			ticket_contribution_cents: '1000'
		});
	});

	it('adds no line item at exactly the suggested price', async () => {
		await purchase({ unitPriceCents: 1500, collectiveCents: 0 });

		expect(lineItems().lineItems).toEqual([{ key: 'ticket', unitAmountCents: 1500, quantity: 1 }]);
		expect(lineItems().metadata).toMatchObject({ ticket_contribution_cents: '0' });
		expect(ticketArgs()).toMatchObject({ contributionCents: 0 });
	});

	it('carries the allocation into metadata for settle-time reconciliation', async () => {
		await purchase({ unitPriceCents: 1500, collectiveCents: 400 });

		expect(lineItems().metadata).toMatchObject({
			ticket_acts_cents: String(1500 - 400 - 74),
			ticket_collective_cents: '400'
		});
	});
});

describe('purchaseTickets at zero', () => {
	it('never touches Stripe, and mints valid tickets outright', async () => {
		await purchase({ quantity: 2, unitPriceCents: 0, collectiveCents: 0 });

		expect(checkout).not.toHaveBeenCalled();
		expect(createTickets).not.toHaveBeenCalled();
		expect(issueFreeTickets).toHaveBeenCalledWith(
			expect.objectContaining({ eventId: 'evt-1', quantity: 2 })
		);
	});

	it('caps how many free tickets one email can take for one show', async () => {
		// A paid ticket has a card behind it. A free one has none, and the 1\u201310 cap
		// on the form is per submission — so ten requests would mint a sold-out
		// show that nobody can get into.
		countTicketsForEmail.mockResolvedValue(5);

		await expect(
			purchase({ quantity: 3, unitPriceCents: 0, collectiveCents: 0 })
		).rejects.toBeDefined();
		expect(issueFreeTickets).not.toHaveBeenCalled();
	});

	it('lets the same email come back for more while under the cap', async () => {
		countTicketsForEmail.mockResolvedValue(4);

		await purchase({ quantity: 2, unitPriceCents: 0, collectiveCents: 0 });

		expect(issueFreeTickets).toHaveBeenCalled();
	});
});
