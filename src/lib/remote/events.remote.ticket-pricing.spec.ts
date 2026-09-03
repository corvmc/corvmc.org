import { describe, it, expect, vi, beforeEach } from 'vitest';

// What a signed-in buyer is actually charged for a ticket, and what the ticket
// row remembers about it. A scenario slice rather than more cases in
// `events.remote.validation.spec.ts`: that file mocks `getRequestEvent` with a
// guest (`locals.user: null`) on purpose, and every discount question here needs
// an account behind it.

type TicketArgs = Record<string, unknown>;
const createTickets = vi.fn(async (_opts: TicketArgs) => [{ id: 'ticket-1' }]);
vi.mock('$lib/server/ticket/ticket-service', () => ({
	getTicketsRemaining: vi.fn(async () => null),
	getTicketsSold: vi.fn(),
	getEventTickets: vi.fn(),
	getUserTickets: vi.fn(),
	getTicketsByPurchase: vi.fn(),
	createTickets: (opts: TicketArgs) => createTickets(opts),
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

const isSustainingMember = vi.fn(async () => false);
vi.mock('$lib/server/finance/subscription-service', () => ({
	isSustainingMember: (...a: unknown[]) => isSustainingMember(...(a as []))
}));

// A published CMC show at $15 — the only thing under test is the price.
vi.mock('$lib/server/event/event-service', () => ({
	create: vi.fn(),
	update: vi.fn(),
	checkRebookNeeded: vi.fn(),
	publish: vi.fn(),
	unpublish: vi.fn(),
	cancel: vi.fn(),
	getById: vi.fn(async (id: string) => ({
		id,
		title: 'Open Mic Night',
		status: 'published',
		ticketingEnabled: true,
		ticketPrice: 1500,
		source: 'cmc'
	})),
	listAll: vi.fn(),
	listUpcoming: vi.fn(),
	listPast: vi.fn()
}));

vi.mock('$lib/server/authorization', () => ({
	requireCapability: vi.fn(async () => ({ id: 'staff-1' })),
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
});

describe('purchaseTickets member discount', () => {
	it('charges a sustaining member half price by default', async () => {
		isSustainingMember.mockResolvedValue(true);

		await purchase({ quantity: 2 });

		expect(lineItems().lineItems).toEqual([{ key: 'ticket', unitAmountCents: 750, quantity: 2 }]);
		expect(ticketArgs()).toMatchObject({ unitPriceCents: 750, discountWaived: false });
	});

	it('charges full price when the member waives the discount, and records that they did', async () => {
		isSustainingMember.mockResolvedValue(true);

		await purchase({ quantity: 2, waiveDiscount: true });

		expect(lineItems().lineItems).toEqual([{ key: 'ticket', unitAmountCents: 1500, quantity: 2 }]);
		expect(ticketArgs()).toMatchObject({ unitPriceCents: 1500, discountWaived: true });
	});

	it('does not mark a non-member as having waived a discount they never had', async () => {
		await purchase({ waiveDiscount: true });

		expect(lineItems().lineItems).toEqual([{ key: 'ticket', unitAmountCents: 1500, quantity: 1 }]);
		expect(ticketArgs()).toMatchObject({ discountWaived: false });
	});
});

describe('purchaseTickets contribution', () => {
	it('charges a contribution as its own line item, not as a bigger ticket', async () => {
		await purchase({ quantity: 2, contribution: '10' });

		expect(lineItems().lineItems).toEqual([
			{ key: 'ticket', unitAmountCents: 1500, quantity: 2 },
			{ key: 'ticket_contribution', unitAmountCents: 1000, quantity: 1 }
		]);
		expect(ticketArgs()).toMatchObject({ contributionCents: 1000 });
	});

	it('tells the webhook what the contribution was, so the receipt can name it', async () => {
		await purchase({ contribution: '10' });

		expect(lineItems().metadata).toMatchObject({
			ticket_unit_price_cents: '1500',
			ticket_contribution_cents: '1000'
		});
	});

	it('adds no line item when the buyer skipped the field', async () => {
		await purchase({ contribution: '' });

		expect(lineItems().lineItems).toEqual([{ key: 'ticket', unitAmountCents: 1500, quantity: 1 }]);
		expect(lineItems().metadata).toMatchObject({ ticket_contribution_cents: '0' });
		expect(ticketArgs()).toMatchObject({ contributionCents: 0 });
	});

	it('lets a member take the discount and still contribute', async () => {
		isSustainingMember.mockResolvedValue(true);

		await purchase({ contribution: '25' });

		expect(lineItems().lineItems).toEqual([
			{ key: 'ticket', unitAmountCents: 750, quantity: 1 },
			{ key: 'ticket_contribution', unitAmountCents: 2500, quantity: 1 }
		]);
	});
});
