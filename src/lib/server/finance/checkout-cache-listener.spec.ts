import { describe, it, expect, vi, beforeEach } from 'vitest';

const inserted: unknown[] = [];
let insertThrows: Error | null = null;
const mockCapture = vi.fn();

vi.mock('$lib/server/sentry', () => ({ captureException: (...a: unknown[]) => mockCapture(...a) }));

vi.mock('$lib/server/db', () => ({
	db: {
		insert: () => ({
			values: async (row: unknown) => {
				if (insertThrows) throw insertThrows;
				inserted.push(row);
			}
		})
	}
}));

vi.mock('$lib/server/db/schema/finance', () => ({ paymentCache: {} }));

const { handleCheckoutCache } = await import('./checkout-cache-listener');

/** The shape the webhook hands over, trimmed to what the listener reads. */
const session = (over: Record<string, unknown> = {}) =>
	({
		id: 'cs_test_1',
		payment_intent: 'pi_test_1',
		customer: 'cus_1',
		amount_total: 2000,
		currency: 'usd',
		metadata: { user_id: 'user-1' },
		...over
	}) as never;

beforeEach(() => {
	inserted.length = 0;
	insertThrows = null;
	mockCapture.mockClear();
});

describe('caching a completed card checkout', () => {
	it('records the payment intent, which is what the purchasable stores', async () => {
		await handleCheckoutCache(session());
		expect(inserted[0]).toMatchObject({
			id: 'pi_test_1',
			userId: 'user-1',
			amountCents: 2000,
			paymentMethod: 'Card',
			status: 'completed'
		});
	});

	it('falls back to the session id when there is no payment intent', async () => {
		// Matches `checkout-listener.ts`, which writes the same id onto the
		// reservation — a row keyed differently could not be joined back.
		await handleCheckoutCache(session({ payment_intent: null }));
		expect(inserted[0]).toMatchObject({ id: 'cs_test_1' });
	});

	it('carries the reservation through when the checkout was for one', async () => {
		await handleCheckoutCache(
			session({ metadata: { user_id: 'user-1', reservation_id: 'res-9' } })
		);
		expect(inserted[0]).toMatchObject({ reservationId: 'res-9' });
	});

	it('skips a guest checkout rather than attributing it to nobody', async () => {
		// `payment_cache.user_id` is NOT NULL and a guest ticket has no member
		// behind it; the ticket row already records the purchase.
		await handleCheckoutCache(session({ metadata: {} }));
		expect(inserted).toHaveLength(0);
		expect(mockCapture).not.toHaveBeenCalled();
	});

	it('treats a Stripe webhook retry as success, not an error', async () => {
		insertThrows = new Error('UNIQUE constraint failed: payment_cache.id');
		await expect(handleCheckoutCache(session())).resolves.toBeUndefined();
		expect(mockCapture).not.toHaveBeenCalled();
	});

	it('never fails a checkout the member has already paid for', async () => {
		insertThrows = new Error('D1_ERROR: no such table');
		await expect(handleCheckoutCache(session())).resolves.toBeUndefined();
		expect(mockCapture).toHaveBeenCalled();
	});
});
