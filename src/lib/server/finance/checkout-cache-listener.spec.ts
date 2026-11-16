import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Against a real SQLite behind the D1 driver, so a duplicate fails as it does in production. */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const mockCapture = vi.fn();
vi.mock('#lib/server/sentry.js', () => ({
	captureException: (...a: unknown[]) => mockCapture(...a)
}));

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

const cached = () =>
	sqlite
		.prepare(
			`select id, user_id, reservation_id, amount_cents, payment_method, status from payment_cache`
		)
		.all();

beforeEach(() => {
	sqlite.exec('drop trigger if exists fail_cache_insert');
	sqlite.exec('delete from payment_cache');
	mockCapture.mockClear();
});

describe('caching a completed card checkout', () => {
	it('records the payment intent, which is what the purchasable stores', async () => {
		await handleCheckoutCache(session());
		expect(cached()).toEqual([
			{
				id: 'pi_test_1',
				user_id: 'user-1',
				reservation_id: null,
				amount_cents: 2000,
				payment_method: 'Card',
				status: 'completed'
			}
		]);
	});

	it('falls back to the session id when there is no payment intent', async () => {
		// Matches `checkout-listener.ts`, which writes the same id onto the
		// reservation — a row keyed differently could not be joined back.
		await handleCheckoutCache(session({ payment_intent: null }));
		expect(cached()).toMatchObject([{ id: 'cs_test_1' }]);
	});

	it('carries the reservation through when the checkout was for one', async () => {
		await handleCheckoutCache(
			session({ metadata: { user_id: 'user-1', reservation_id: 'res-9' } })
		);
		expect(cached()).toMatchObject([{ reservation_id: 'res-9' }]);
	});

	it('skips a guest checkout rather than attributing it to nobody', async () => {
		// `payment_cache.user_id` is NOT NULL and a guest ticket has no member
		// behind it; the ticket row already records the purchase.
		await handleCheckoutCache(session({ metadata: {} }));
		expect(cached()).toHaveLength(0);
		expect(mockCapture).not.toHaveBeenCalled();
	});

	it('treats a Stripe webhook retry as success, not an error', async () => {
		await handleCheckoutCache(session());
		await expect(handleCheckoutCache(session())).resolves.toBeUndefined();
		expect(cached()).toHaveLength(1);
		expect(mockCapture).not.toHaveBeenCalled();
	});

	it('never fails a checkout the member has already paid for', async () => {
		sqlite.exec(
			`create trigger fail_cache_insert before insert on payment_cache
			 begin select raise(abort, 'disk on fire'); end`
		);
		await expect(handleCheckoutCache(session())).resolves.toBeUndefined();
		expect(mockCapture).toHaveBeenCalled();
	});
});
