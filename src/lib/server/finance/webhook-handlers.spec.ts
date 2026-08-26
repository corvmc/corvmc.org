import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Stripe from 'stripe';

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------
let userQueryResults: unknown[] = [];

function chainable() {
	const proxy: any = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				return (resolve: (v: unknown[]) => void) => resolve(userQueryResults);
			}
			return () => proxy;
		}
	});
	return proxy;
}

vi.mock('$lib/server/db', () => ({
	db: {
		select: () => chainable(),
		update: () => chainable()
	}
}));

const mockCreditService = {
	hasTransaction: vi.fn().mockResolvedValue(false),
	allocateMonthlyCredits: vi.fn(),
	allocateEquipmentCredits: vi.fn(),
	setBalance: vi.fn()
};
vi.mock('./credit-service', () => mockCreditService);

const mockEmit = vi.fn();
vi.mock('$lib/server/event-bus/event-bus', () => ({
	domainEvents: { emit: mockEmit }
}));

vi.mock('./webhook-events', () => ({
	registeredEvents: ['checkout.session.completed', 'invoice.paid', 'customer.subscription.deleted']
}));

vi.mock('$lib/server/reservation/recurring-series-service', () => ({
	cancelAllForUser: vi.fn()
}));

const mockGetStripeProductId = vi.fn().mockResolvedValue('prod_fee');
vi.mock('./product-config-service', () => ({
	getStripeProductId: (...args: unknown[]) => mockGetStripeProductId(...args)
}));

const { handleCheckoutCompleted, handleInvoicePaid, handleSubscriptionDeleted } =
	await import('./webhook-handlers');

// ---------------------------------------------------------------------------
// handleCheckoutCompleted
// ---------------------------------------------------------------------------
describe('handleCheckoutCompleted', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		userQueryResults = [];
	});

	it('emits checkout.completed domain event with session data', async () => {
		const session = {
			id: 'cs_123',
			metadata: { reservation_id: 'res-42' }
		} as unknown as Stripe.Checkout.Session;
		await handleCheckoutCompleted(session);

		expect(mockEmit).toHaveBeenCalledWith('checkout.completed', {
			sessionId: 'cs_123',
			metadata: { reservation_id: 'res-42' },
			stripeSession: session
		});
	});

	it('defaults metadata to empty object when null', async () => {
		const session = { id: 'cs_no_meta', metadata: null } as unknown as Stripe.Checkout.Session;
		await handleCheckoutCompleted(session);

		expect(mockEmit).toHaveBeenCalledWith('checkout.completed', {
			sessionId: 'cs_no_meta',
			metadata: {},
			stripeSession: session
		});
	});
});

// ---------------------------------------------------------------------------
// handleInvoicePaid
// ---------------------------------------------------------------------------
describe('handleInvoicePaid', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		userQueryResults = [];
	});

	it('allocates monthly credits based on subscription quantity', async () => {
		userQueryResults = [{ id: 'user-1' }];
		mockCreditService.allocateMonthlyCredits.mockResolvedValue(5);

		const invoice = {
			id: 'inv_123',
			parent: {
				subscription_details: { subscription: 'sub_abc' }
			},
			customer: 'cus_123',
			lines: {
				data: [
					{
						parent: { subscription_item_details: { subscription_item: 'si_abc' } },
						quantity: 5,
						amount: 2500
					}
				]
			}
		} as unknown as Stripe.Invoice;

		await handleInvoicePaid(invoice);

		// Credits granted = quantity × 2 (each $5-unit = 1 hour = 2 thirty-min credits).
		expect(mockCreditService.allocateMonthlyCredits).toHaveBeenCalledWith('user-1', 10, 'inv_123');
	});

	it('handles customer as an object with id property', async () => {
		userQueryResults = [{ id: 'user-2' }];
		mockCreditService.allocateMonthlyCredits.mockResolvedValue(3);

		const invoice = {
			id: 'inv_obj_cus',
			parent: {
				subscription_details: { subscription: { id: 'sub_obj' } }
			},
			customer: { id: 'cus_456' },
			lines: {
				data: [
					{
						parent: { subscription_item_details: { subscription_item: 'si_obj' } },
						quantity: 3,
						amount: 1500
					}
				]
			}
		} as unknown as Stripe.Invoice;

		await handleInvoicePaid(invoice);

		expect(mockCreditService.allocateMonthlyCredits).toHaveBeenCalledWith(
			'user-2',
			6,
			'inv_obj_cus'
		);
	});

	it('skips non-subscription invoices', async () => {
		const invoice = {
			id: 'inv_one_time',
			parent: { subscription_details: null },
			customer: 'cus_123'
		} as unknown as Stripe.Invoice;

		await handleInvoicePaid(invoice);

		expect(mockCreditService.allocateMonthlyCredits).not.toHaveBeenCalled();
	});

	it('skips lines without subscription_item_details', async () => {
		userQueryResults = [{ id: 'user-1' }];
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const invoice = {
			id: 'inv_proration',
			parent: {
				subscription_details: { subscription: 'sub_abc' }
			},
			customer: 'cus_123',
			lines: {
				data: [{ parent: { subscription_item_details: null }, quantity: 1, amount: 100 }]
			}
		} as unknown as Stripe.Invoice;

		await handleInvoicePaid(invoice);

		expect(mockCreditService.allocateMonthlyCredits).not.toHaveBeenCalled();
		warnSpy.mockRestore();
	});

	it('allocates from the contribution line even when the fee line comes first', async () => {
		userQueryResults = [{ id: 'user-1' }];
		mockCreditService.allocateMonthlyCredits.mockResolvedValue(24);

		// Stripe does not guarantee line ordering — the fee-coverage line also
		// matches "subscription line with quantity > 0" and must not be picked.
		const invoice = {
			id: 'inv_fee_first',
			parent: { subscription_details: { subscription: 'sub_abc' } },
			customer: 'cus_123',
			lines: {
				data: [
					{
						parent: { subscription_item_details: { subscription_item: 'si_fee' } },
						pricing: { price_details: { product: 'prod_fee' } },
						quantity: 1,
						amount: 209
					},
					{
						parent: { subscription_item_details: { subscription_item: 'si_contrib' } },
						pricing: { price_details: { product: 'prod_contrib' } },
						quantity: 12,
						amount: 6000
					}
				]
			}
		} as unknown as Stripe.Invoice;

		await handleInvoicePaid(invoice);

		// 6000¢ / 250 = 24 credits — NOT round(209/250) = 1 from the fee line.
		expect(mockCreditService.allocateMonthlyCredits).toHaveBeenCalledWith(
			'user-1',
			24,
			'inv_fee_first'
		);
		expect(mockCreditService.allocateEquipmentCredits).toHaveBeenCalledWith(
			'user-1',
			6000,
			'inv_fee_first'
		);
	});

	it('ignores proration lines when picking the contribution line', async () => {
		userQueryResults = [{ id: 'user-1' }];
		mockCreditService.allocateMonthlyCredits.mockResolvedValue(10);

		const invoice = {
			id: 'inv_prorated',
			parent: { subscription_details: { subscription: 'sub_abc' } },
			customer: 'cus_123',
			lines: {
				data: [
					{
						// Mid-cycle upgrade proration — larger amount, must be skipped.
						parent: {
							subscription_item_details: { subscription_item: 'si_contrib', proration: true }
						},
						pricing: { price_details: { product: 'prod_contrib' } },
						quantity: 14,
						amount: 7000
					},
					{
						parent: {
							subscription_item_details: { subscription_item: 'si_contrib', proration: false }
						},
						pricing: { price_details: { product: 'prod_contrib' } },
						quantity: 5,
						amount: 2500
					}
				]
			}
		} as unknown as Stripe.Invoice;

		await handleInvoicePaid(invoice);

		expect(mockCreditService.allocateMonthlyCredits).toHaveBeenCalledWith(
			'user-1',
			10,
			'inv_prorated'
		);
	});

	it('falls back to the largest-amount line when the fee product id is unresolvable', async () => {
		userQueryResults = [{ id: 'user-1' }];
		mockGetStripeProductId.mockRejectedValueOnce(new Error('KV unavailable'));
		mockCreditService.allocateMonthlyCredits.mockResolvedValue(24);

		const invoice = {
			id: 'inv_fee_unknown',
			parent: { subscription_details: { subscription: 'sub_abc' } },
			customer: 'cus_123',
			lines: {
				data: [
					{
						parent: { subscription_item_details: { subscription_item: 'si_fee' } },
						quantity: 1,
						amount: 209
					},
					{
						parent: { subscription_item_details: { subscription_item: 'si_contrib' } },
						quantity: 12,
						amount: 6000
					}
				]
			}
		} as unknown as Stripe.Invoice;

		await handleInvoicePaid(invoice);

		// The fee (~3% + 30¢) is always smaller than the contribution it covers.
		expect(mockCreditService.allocateMonthlyCredits).toHaveBeenCalledWith(
			'user-1',
			24,
			'inv_fee_unknown'
		);
	});

	it('warns when no user found for customer', async () => {
		userQueryResults = [];
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const invoice = {
			id: 'inv_orphan',
			parent: {
				subscription_details: { subscription: 'sub_xyz' }
			},
			customer: 'cus_unknown',
			lines: {
				data: [
					{ parent: { subscription_item_details: { subscription_item: 'si_xyz' } }, quantity: 3 }
				]
			}
		} as unknown as Stripe.Invoice;

		await handleInvoicePaid(invoice);

		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no user found'));
		expect(mockCreditService.allocateMonthlyCredits).not.toHaveBeenCalled();
		warnSpy.mockRestore();
	});
});

// ---------------------------------------------------------------------------
// handleSubscriptionDeleted
// ---------------------------------------------------------------------------
describe('handleSubscriptionDeleted', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		userQueryResults = [];
	});

	it('resets free_hours balance to 0', async () => {
		userQueryResults = [{ id: 'user-1' }];
		mockCreditService.setBalance.mockResolvedValue(0);

		const subscription = {
			id: 'sub_cancelled',
			customer: 'cus_123'
		} as unknown as Stripe.Subscription;

		await handleSubscriptionDeleted(subscription);

		expect(mockCreditService.setBalance).toHaveBeenCalledWith(
			'user-1',
			'free_hours',
			0,
			'monthly_allocation',
			'sub_cancelled',
			expect.any(String)
		);
	});

	it('warns when no user found for customer', async () => {
		userQueryResults = [];
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const subscription = {
			id: 'sub_orphan',
			customer: 'cus_ghost'
		} as unknown as Stripe.Subscription;

		await handleSubscriptionDeleted(subscription);

		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no user found'));
		expect(mockCreditService.setBalance).not.toHaveBeenCalled();
		warnSpy.mockRestore();
	});
});
