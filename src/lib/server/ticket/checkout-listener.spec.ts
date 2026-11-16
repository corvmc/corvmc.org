import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Stripe from 'stripe';

// The checkout listener against a real SQLite with the real ticket service:
// what it flips is the purchase's pending rows, and what it emits is read
// back from them. The session is a plain object; Stripe is never called.
const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const mockEmit = vi.fn();
vi.mock('#lib/server/event-bus/event-bus.js', () => ({
	domainEvents: { emit: (...args: unknown[]) => mockEmit(...args) }
}));
vi.mock('#lib/server/sentry.js', () => ({ captureException: vi.fn() }));

const { handleTicketCheckout } = await import('./checkout-listener');

const T0 = 1_750_000_000;
const STARTS = Date.parse('2026-05-14T20:00:00Z') / 1000;

function ticket(id: string, purchaseId: string, status = 'pending', eventId = 'event-1') {
	sqlite
		.prepare(
			`insert into ticket (id, event_id, purchase_id, attendee_name, attendee_email, code, status, created_at, updated_at)
			 values (?, ?, ?, 'Jo', 'jo@x.com', ?, ?, ?, ?)`
		)
		.run(id, eventId, purchaseId, `CODE-${id}`, status, T0, T0);
}

const tickets = () =>
	sqlite
		.prepare('select id, status, stripe_payment_record_id as record from ticket order by id')
		.all() as { id: string; status: string; record: string | null }[];

const session = (s: Record<string, unknown>) => s as unknown as Stripe.Checkout.Session;

/** The payload passed to domainEvents.emit('ticket.purchased', …). */
function emittedPayload() {
	const call = mockEmit.mock.calls.find((c) => c[0] === 'ticket.purchased');
	return call?.[1] as Record<string, unknown> | undefined;
}

beforeEach(() => {
	vi.clearAllMocks();
	for (const t of ['ticket', 'event_listing']) sqlite.exec(`delete from ${t}`);
	sqlite
		.prepare(
			`insert into event_listing (id, title, starts_at, ends_at, created_by_user_id) values ('event-1', 'Jazz Night', ?, ?, 'user-1')`
		)
		.run(STARTS, STARTS + 3 * 3600);
});

describe('handleTicketCheckout', () => {
	it("validates that purchase's pending tickets and no one else's", async () => {
		ticket('t1', 'purchase-abc');
		ticket('t2', 'purchase-abc');
		ticket('t3', 'purchase-other');
		ticket('t4', 'purchase-abc', 'cancelled');

		await handleTicketCheckout(
			session({ id: 'cs_test_123', metadata: { type: 'ticket', purchase_id: 'purchase-abc' } })
		);

		expect(tickets()).toEqual([
			{ id: 't1', status: 'valid', record: 'cs_test_123' },
			{ id: 't2', status: 'valid', record: 'cs_test_123' },
			{ id: 't3', status: 'pending', record: null },
			{ id: 't4', status: 'cancelled', record: null }
		]);
	});

	it('ignores sessions without ticket type', async () => {
		ticket('t1', 'purchase-abc');
		await handleTicketCheckout(
			session({ id: 'cs_456', metadata: { type: 'reservation', purchase_id: 'purchase-abc' } })
		);
		expect(tickets()[0].status).toBe('pending');
	});

	it('ignores sessions without metadata', async () => {
		ticket('t1', 'purchase-abc');
		await handleTicketCheckout(session({ id: 'cs_789', metadata: null }));
		expect(tickets()[0].status).toBe('pending');
	});

	it('ignores sessions without purchase_id', async () => {
		ticket('t1', 'purchase-abc');
		await handleTicketCheckout(session({ id: 'cs_000', metadata: { type: 'ticket' } }));
		expect(tickets()[0].status).toBe('pending');
		expect(mockEmit).not.toHaveBeenCalled();
	});

	it('stores the payment intent id when payment_intent is a string', async () => {
		ticket('t1', 'purchase-abc');
		await handleTicketCheckout(
			session({
				id: 'cs_pi_string',
				payment_intent: 'pi_abc123',
				metadata: { type: 'ticket', purchase_id: 'purchase-abc' }
			})
		);
		expect(tickets()[0].record).toBe('pi_abc123');
	});

	it('stores the payment intent id when payment_intent is an expanded object', async () => {
		ticket('t1', 'purchase-abc');
		await handleTicketCheckout(
			session({
				id: 'cs_pi_object',
				payment_intent: { id: 'pi_expanded_456' },
				metadata: { type: 'ticket', purchase_id: 'purchase-abc' }
			})
		);
		expect(tickets()[0].record).toBe('pi_expanded_456');
	});

	it('emits nothing when the purchase has no pending tickets left', async () => {
		ticket('t1', 'purchase-abc', 'valid');
		await handleTicketCheckout(
			session({ id: 'cs_replay', metadata: { type: 'ticket', purchase_id: 'purchase-abc' } })
		);
		expect(mockEmit).not.toHaveBeenCalled();
	});

	it('emits the receipt with the event and the purchase’s codes', async () => {
		ticket('t1', 'purchase-abc');
		ticket('t2', 'purchase-abc');
		await handleTicketCheckout(
			session({ id: 'cs_emit', metadata: { type: 'ticket', purchase_id: 'purchase-abc' } })
		);
		expect(emittedPayload()).toMatchObject({
			purchaseId: 'purchase-abc',
			eventId: 'event-1',
			eventTitle: 'Jazz Night',
			attendeeEmail: 'jo@x.com',
			quantity: 2
		});
		expect((emittedPayload()?.ticketCodes as string[]).sort()).toEqual(['CODE-t1', 'CODE-t2']);
	});
});

// A guest has no account and no order history — the confirmation email is their
// only record of what they paid, so the emitted event has to carry the money.
describe('handleTicketCheckout receipt amounts', () => {
	beforeEach(() => {
		ticket('t1', 'purchase-abc');
		ticket('t2', 'purchase-abc');
	});

	const checkout = (amounts: { subtotal: number; total: number }, meta: Record<string, string>) =>
		handleTicketCheckout(
			session({
				id: 'cs_amounts',
				amount_subtotal: amounts.subtotal,
				amount_total: amounts.total,
				metadata: { type: 'ticket', purchase_id: 'purchase-abc', ticket_quantity: '2', ...meta }
			})
		);

	it('splits the charge into ticket subtotal and covered fees', async () => {
		await checkout({ subtotal: 4120, total: 4120 }, { ticket_unit_price_cents: '2000' });

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
		await checkout({ subtotal: 4000, total: 4000 }, { ticket_unit_price_cents: '2000' });

		expect(emittedPayload()).toMatchObject({ subtotalCents: 4000, feesCents: 0, totalCents: 4000 });
	});

	// Two $20 tickets plus a $10 gift, no fee coverage. Subtracting only the
	// ticket subtotal would book the entire gift as a processing fee.
	it('reports a contribution as a contribution, not as processing fees', async () => {
		await checkout(
			{ subtotal: 5000, total: 5000 },
			{ ticket_unit_price_cents: '2000', ticket_contribution_cents: '1000' }
		);

		expect(emittedPayload()).toMatchObject({
			subtotalCents: 4000,
			contributionCents: 1000,
			feesCents: 0,
			totalCents: 5000
		});
	});

	it('separates a contribution from covered fees on the same order', async () => {
		await checkout(
			{ subtotal: 5180, total: 5180 },
			{ ticket_unit_price_cents: '2000', ticket_contribution_cents: '1000' }
		);

		expect(emittedPayload()).toMatchObject({
			subtotalCents: 4000,
			contributionCents: 1000,
			feesCents: 180,
			totalCents: 5180
		});
	});

	it('reports no contribution when the buyer did not add one', async () => {
		await checkout({ subtotal: 4000, total: 4000 }, { ticket_unit_price_cents: '2000' });

		expect(emittedPayload()).toMatchObject({ contributionCents: 0, feesCents: 0 });
	});

	// Sessions created before this metadata existed must still produce a
	// coherent receipt rather than booking the whole charge as fees.
	it('falls back to the charged total when the unit price metadata is missing', async () => {
		await checkout({ subtotal: 4000, total: 4000 }, {});

		expect(emittedPayload()).toMatchObject({
			unitPriceCents: 0,
			subtotalCents: 4000,
			feesCents: 0,
			totalCents: 4000
		});
	});
});
