import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFulfillPurchase = vi.fn();
const mockEmit = vi.fn();

/** Rows the event lookup resolves to. Empty by default so the listener bails
 *  before emitting; the receipt tests set a row to exercise the emit path. */
const mockEventLookup = vi.fn<() => Promise<unknown[]>>();

vi.mock('./ticket-service', () => ({
	fulfillPurchase: (...args: unknown[]) => mockFulfillPurchase(...args)
}));

vi.mock('$lib/server/event-bus/event-bus', () => ({
	domainEvents: { emit: (...args: unknown[]) => mockEmit(...args) }
}));

vi.mock('$lib/server/sentry', () => ({ captureException: vi.fn() }));

vi.mock('$lib/server/db', () => ({
	db: {
		select: () => ({ from: () => ({ where: () => ({ limit: () => mockEventLookup() }) }) })
	}
}));

vi.mock('$lib/server/db/schema/event', () => ({
	eventListing: {}
}));

vi.mock('drizzle-orm', () => ({
	eq: vi.fn()
}));

vi.mock('luxon', () => ({
	DateTime: { fromJSDate: () => ({ toLocaleString: () => 'May 14, 2026' }) }
}));

// Import after mocks
const { handleTicketCheckout } = await import('./checkout-listener');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
	vi.clearAllMocks();
	mockEventLookup.mockResolvedValue([]);
});

describe('handleTicketCheckout', () => {
	it('calls fulfillPurchase when session has ticket metadata', async () => {
		mockFulfillPurchase.mockResolvedValue([
			{
				id: 't1',
				eventId: 'event-1',
				code: 'ABC',
				attendeeName: 'Jo',
				attendeeEmail: 'jo@test.com'
			},
			{
				id: 't2',
				eventId: 'event-1',
				code: 'DEF',
				attendeeName: 'Jo',
				attendeeEmail: 'jo@test.com'
			}
		]);

		await handleTicketCheckout({
			id: 'cs_test_123',
			metadata: {
				type: 'ticket',
				purchase_id: 'purchase-abc',
				event_id: 'event-1',
				ticket_quantity: '2'
			}
		} as any);

		expect(mockFulfillPurchase).toHaveBeenCalledWith('purchase-abc', 'cs_test_123');
	});

	it('ignores sessions without ticket type', async () => {
		await handleTicketCheckout({
			id: 'cs_test_456',
			metadata: {
				type: 'reservation',
				reservation_id: 'res-1'
			}
		} as any);

		expect(mockFulfillPurchase).not.toHaveBeenCalled();
	});

	it('ignores sessions without metadata', async () => {
		await handleTicketCheckout({
			id: 'cs_test_789',
			metadata: null
		} as any);

		expect(mockFulfillPurchase).not.toHaveBeenCalled();
	});

	it('ignores sessions without purchase_id', async () => {
		await handleTicketCheckout({
			id: 'cs_test_000',
			metadata: {
				type: 'ticket'
				// missing purchase_id
			}
		} as any);

		expect(mockFulfillPurchase).not.toHaveBeenCalled();
	});

	it('stores the payment intent id when payment_intent is a string', async () => {
		mockFulfillPurchase.mockResolvedValue([
			{
				id: 't1',
				eventId: 'event-1',
				code: 'ABC',
				attendeeName: 'Jo',
				attendeeEmail: 'jo@test.com'
			}
		]);

		await handleTicketCheckout({
			id: 'cs_test_pi_string',
			payment_intent: 'pi_abc123',
			metadata: { type: 'ticket', purchase_id: 'purchase-abc' }
		} as any);

		expect(mockFulfillPurchase).toHaveBeenCalledWith('purchase-abc', 'pi_abc123');
	});

	it('stores the payment intent id when payment_intent is an expanded object', async () => {
		mockFulfillPurchase.mockResolvedValue([
			{
				id: 't1',
				eventId: 'event-1',
				code: 'ABC',
				attendeeName: 'Jo',
				attendeeEmail: 'jo@test.com'
			}
		]);

		await handleTicketCheckout({
			id: 'cs_test_pi_object',
			payment_intent: { id: 'pi_expanded_456' },
			metadata: { type: 'ticket', purchase_id: 'purchase-def' }
		} as any);

		expect(mockFulfillPurchase).toHaveBeenCalledWith('purchase-def', 'pi_expanded_456');
	});

	it('falls back to the session id when the session has no payment_intent', async () => {
		mockFulfillPurchase.mockResolvedValue([
			{
				id: 't1',
				eventId: 'event-1',
				code: 'ABC',
				attendeeName: 'Jo',
				attendeeEmail: 'jo@test.com'
			}
		]);

		await handleTicketCheckout({
			id: 'cs_test_no_pi',
			metadata: { type: 'ticket', purchase_id: 'purchase-ghi' }
		} as any);

		expect(mockFulfillPurchase).toHaveBeenCalledWith('purchase-ghi', 'cs_test_no_pi');
	});

	it('skips event emission when fulfillPurchase returns empty array', async () => {
		mockFulfillPurchase.mockResolvedValue([]);

		await handleTicketCheckout({
			id: 'cs_test_skip',
			metadata: {
				type: 'ticket',
				purchase_id: 'purchase-none'
			}
		} as any);

		expect(mockFulfillPurchase).toHaveBeenCalledWith('purchase-none', 'cs_test_skip');
	});
});

// ---------------------------------------------------------------------------
// Receipt amounts
// ---------------------------------------------------------------------------
// A guest has no account and no order history — the confirmation email is their
// only record of what they paid, so the emitted event has to carry the money.

describe('handleTicketCheckout receipt amounts', () => {
	beforeEach(() => {
		mockEventLookup.mockResolvedValue([
			{ id: 'event-1', title: 'Jazz Night', startsAt: new Date('2026-05-14T20:00:00Z') }
		]);
		mockFulfillPurchase.mockResolvedValue([
			{ id: 't1', eventId: 'event-1', code: 'ABC', attendeeName: 'Jo', attendeeEmail: 'jo@x.com' },
			{ id: 't2', eventId: 'event-1', code: 'DEF', attendeeName: 'Jo', attendeeEmail: 'jo@x.com' }
		]);
	});

	/** The payload passed to domainEvents.emit('ticket.purchased', …). */
	function emittedPayload() {
		const call = mockEmit.mock.calls.find((c) => c[0] === 'ticket.purchased');
		return call?.[1] as Record<string, unknown> | undefined;
	}

	it('splits the charge into ticket subtotal and covered fees', async () => {
		await handleTicketCheckout({
			id: 'cs_fees',
			amount_subtotal: 4120,
			amount_total: 4120,
			metadata: {
				type: 'ticket',
				purchase_id: 'purchase-abc',
				ticket_quantity: '2',
				ticket_unit_price_cents: '2000'
			}
		} as any);

		expect(emittedPayload()).toMatchObject({
			eventId: 'event-1',
			unitPriceCents: 2000,
			subtotalCents: 4000,
			feesCents: 120,
			totalCents: 4120,
			quantity: 2
		});
	});

	it('reports zero fees when the buyer did not cover them', async () => {
		await handleTicketCheckout({
			id: 'cs_nofees',
			amount_subtotal: 4000,
			amount_total: 4000,
			metadata: {
				type: 'ticket',
				purchase_id: 'purchase-abc',
				ticket_quantity: '2',
				ticket_unit_price_cents: '2000'
			}
		} as any);

		expect(emittedPayload()).toMatchObject({
			subtotalCents: 4000,
			feesCents: 0,
			totalCents: 4000
		});
	});

	it('reports a contribution as a contribution, not as processing fees', async () => {
		// Two $20 tickets plus a $10 gift, no fee coverage. Deriving fees by
		// subtracting only the ticket subtotal from Stripe's subtotal would book
		// the entire gift as a processing fee on the buyer's receipt.
		await handleTicketCheckout({
			id: 'cs_gift',
			amount_subtotal: 5000,
			amount_total: 5000,
			metadata: {
				type: 'ticket',
				purchase_id: 'purchase-abc',
				ticket_quantity: '2',
				ticket_unit_price_cents: '2000',
				ticket_contribution_cents: '1000'
			}
		} as any);

		expect(emittedPayload()).toMatchObject({
			subtotalCents: 4000,
			contributionCents: 1000,
			feesCents: 0,
			totalCents: 5000
		});
	});

	it('separates a contribution from covered fees on the same order', async () => {
		await handleTicketCheckout({
			id: 'cs_gift_fees',
			amount_subtotal: 5180,
			amount_total: 5180,
			metadata: {
				type: 'ticket',
				purchase_id: 'purchase-abc',
				ticket_quantity: '2',
				ticket_unit_price_cents: '2000',
				ticket_contribution_cents: '1000'
			}
		} as any);

		expect(emittedPayload()).toMatchObject({
			subtotalCents: 4000,
			contributionCents: 1000,
			feesCents: 180,
			totalCents: 5180
		});
	});

	it('reports no contribution when the buyer did not add one', async () => {
		await handleTicketCheckout({
			id: 'cs_nogift',
			amount_subtotal: 4000,
			amount_total: 4000,
			metadata: {
				type: 'ticket',
				purchase_id: 'purchase-abc',
				ticket_quantity: '2',
				ticket_unit_price_cents: '2000'
			}
		} as any);

		expect(emittedPayload()).toMatchObject({ contributionCents: 0, feesCents: 0 });
	});

	it('falls back to the charged total when the unit price metadata is missing', async () => {
		// Sessions created before this metadata existed must still produce a
		// coherent receipt rather than booking the whole charge as fees.
		await handleTicketCheckout({
			id: 'cs_legacy',
			amount_subtotal: 4000,
			amount_total: 4000,
			metadata: { type: 'ticket', purchase_id: 'purchase-abc', ticket_quantity: '2' }
		} as any);

		expect(emittedPayload()).toMatchObject({
			unitPriceCents: 0,
			subtotalCents: 4000,
			feesCents: 0,
			totalCents: 4000
		});
	});
});
