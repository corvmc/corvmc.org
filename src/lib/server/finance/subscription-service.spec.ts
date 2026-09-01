import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock environment
// ---------------------------------------------------------------------------
vi.mock('$env/dynamic/private', () => ({
	env: {
		STRIPE_CONTRIBUTION_PRICE_ID: 'price_contribution',
		STRIPE_FEE_PRODUCT_ID: 'prod_fee',
		DATABASE_URL: 'postgres://mock'
	}
}));

// Mock product-config-service to prevent db import chain
vi.mock('./product-config-service', () => ({
	getStripeProductId: vi.fn().mockImplementation((key: string) => {
		if (key === 'contribution') return Promise.resolve('prod_contribution');
		if (key === 'fee_coverage') return Promise.resolve('prod_fee');
		return Promise.resolve(`prod_${key}`);
	}),
	getProductConfig: vi.fn().mockResolvedValue({
		key: 'contribution',
		name: 'Monthly Contribution',
		description: 'Monthly membership contribution',
		stripeProductId: 'prod_contribution',
		unitAmountCents: 500,
		unitLabel: null
	}),
	buildSubscriptionLineItem: vi
		.fn()
		.mockImplementation((_key: string, unitAmount: number, quantity: number) =>
			Promise.resolve({
				price_data: {
					currency: 'usd',
					product: 'prod_contribution',
					unit_amount: unitAmount,
					recurring: { interval: 'month' }
				},
				quantity
			})
		)
}));

// ---------------------------------------------------------------------------
// Mock Stripe SDK
// ---------------------------------------------------------------------------
const mockStripe = {
	subscriptions: {
		list: vi.fn(),
		update: vi.fn()
	},
	billingPortal: {
		sessions: {
			create: vi.fn()
		}
	}
};

vi.mock('$lib/server/stripe', () => ({
	stripe: mockStripe
}));

// ---------------------------------------------------------------------------
// Mock shared checkout
// ---------------------------------------------------------------------------
const mockCheckout = vi.fn();
vi.mock('./payment-service', () => ({
	checkout: mockCheckout
}));

const {
	createCheckoutSession,
	getSubscription,
	updateQuantity,
	cancel,
	createBillingPortalUrl,
	resume,
	mapDbSubscription,
	buildMemberSubscriptionState,
	SubscriptionStateError,
	SubscriptionValidationError
} = await import('./subscription-service');

// ---------------------------------------------------------------------------
// createCheckoutSession
// ---------------------------------------------------------------------------
describe('createCheckoutSession', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('delegates to shared checkout with subscription mode', async () => {
		mockCheckout.mockResolvedValue({
			paid: false,
			checkoutUrl: 'https://checkout.stripe.com/sub_sess'
		});

		const url = await createCheckoutSession({
			userId: 'user-1',
			stripeCustomerId: 'cus_123',
			quantity: 5,
			coverFees: false,
			successUrl: 'https://example.com/success',
			cancelUrl: 'https://example.com/cancel'
		});

		expect(url).toBe('https://checkout.stripe.com/sub_sess');
		expect(mockCheckout).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: 'user-1',
				stripeCustomerId: 'cus_123',
				mode: 'subscription',
				lineItems: [
					expect.objectContaining({
						price_data: expect.objectContaining({
							currency: 'usd',
							product: 'prod_contribution',
							recurring: { interval: 'month' }
						}),
						quantity: 5
					})
				],
				coverFees: false,
				metadata: expect.objectContaining({
					subscription_type: 'contribution'
				}),
				successUrl: 'https://example.com/success',
				cancelUrl: 'https://example.com/cancel'
			})
		);
	});

	it('passes coverFees through to shared checkout', async () => {
		mockCheckout.mockResolvedValue({
			paid: false,
			checkoutUrl: 'https://checkout.stripe.com/sub_fee'
		});

		await createCheckoutSession({
			userId: 'user-1',
			stripeCustomerId: 'cus_123',
			quantity: 3,
			coverFees: true,
			successUrl: 'https://example.com/success',
			cancelUrl: 'https://example.com/cancel'
		});

		expect(mockCheckout).toHaveBeenCalledWith(expect.objectContaining({ coverFees: true }));
	});

	it('throws when quantity is less than 1', async () => {
		await expect(
			createCheckoutSession({
				userId: 'user-1',
				stripeCustomerId: 'cus_123',
				quantity: 0,
				coverFees: false,
				successUrl: 'https://example.com/success',
				cancelUrl: 'https://example.com/cancel'
			})
		).rejects.toThrow(SubscriptionValidationError);
	});

	it('throws when checkout returns no URL', async () => {
		mockCheckout.mockResolvedValue({ paid: true });

		await expect(
			createCheckoutSession({
				userId: 'user-1',
				stripeCustomerId: 'cus_123',
				quantity: 5,
				coverFees: false,
				successUrl: 'https://example.com/success',
				cancelUrl: 'https://example.com/cancel'
			})
		).rejects.toThrow();
	});
});

// ---------------------------------------------------------------------------
// getSubscription
// ---------------------------------------------------------------------------
describe('getSubscription', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns subscription info with fee coverage', async () => {
		mockStripe.subscriptions.list.mockResolvedValue({
			data: [
				{
					id: 'sub_abc',
					status: 'active',
					cancel_at_period_end: false,
					items: {
						data: [
							{
								price: { id: 'price_contribution', product: 'prod_contribution' },
								quantity: 5,
								current_period_end: 1700000000
							},
							{
								price: { id: 'price_auto_fee', product: 'prod_fee' },
								quantity: 1,
								current_period_end: 1700000000
							}
						]
					}
				}
			]
		});

		const info = await getSubscription('cus_123');

		expect(info).toEqual({
			id: 'sub_abc',
			status: 'active',
			quantity: 5,
			coveringFees: true,
			currentPeriodEnd: new Date(1700000000 * 1000),
			cancelAtPeriodEnd: false
		});
	});

	it('returns subscription info without fee coverage', async () => {
		mockStripe.subscriptions.list.mockResolvedValue({
			data: [
				{
					id: 'sub_no_fee',
					status: 'active',
					cancel_at_period_end: true,
					items: {
						data: [
							{
								price: { id: 'price_contribution', product: 'prod_contribution' },
								quantity: 3,
								current_period_end: 1700000000
							}
						]
					}
				}
			]
		});

		const info = await getSubscription('cus_123');

		expect(info).toMatchObject({
			quantity: 3,
			coveringFees: false,
			cancelAtPeriodEnd: true
		});
	});

	it('returns null when no active subscription', async () => {
		mockStripe.subscriptions.list.mockResolvedValue({ data: [] });
		expect(await getSubscription('cus_none')).toBeNull();
	});

	it('falls back to a quantity>0 item when no product id matches', async () => {
		// Product ids can drift after a KV/product-config migration; the contribution
		// line is then identified by having a quantity rather than by product id.
		mockStripe.subscriptions.list.mockResolvedValue({
			data: [
				{
					id: 'sub_drift',
					status: 'active',
					cancel_at_period_end: false,
					items: {
						data: [
							{
								price: { id: 'price_x', product: 'prod_unknown' },
								quantity: 4,
								current_period_end: 1700000000
							}
						]
					}
				}
			]
		});

		const info = await getSubscription('cus_drift');
		expect(info?.quantity).toBe(4);
	});
});

// ---------------------------------------------------------------------------
// mapDbSubscription
// ---------------------------------------------------------------------------
describe('mapDbSubscription', () => {
	it('returns null when there is no stored subscription', () => {
		expect(mapDbSubscription(null)).toBeNull();
	});

	it('maps stored credits (blocks) to $5-unit quantity', () => {
		const info = mapDbSubscription({
			startedAt: '2026-01-01T00:00:00.000Z',
			stripeSubscriptionId: 'sub_x',
			hoursPerReset: 24, // credits → 12 units → $60
			creditsResetAt: '2026-07-01T00:00:00.000Z',
			coveringFees: true,
			cancelAtPeriodEnd: false
		});
		expect(info).toEqual({
			id: 'sub_x',
			status: 'active',
			quantity: 12,
			coveringFees: true,
			currentPeriodEnd: new Date('2026-07-01T00:00:00.000Z'),
			cancelAtPeriodEnd: false
		});
	});

	it('defaults missing flags to false (pre-migration rows)', () => {
		const info = mapDbSubscription({
			startedAt: 'x',
			stripeSubscriptionId: 'sub_y',
			hoursPerReset: 4,
			creditsResetAt: '2026-07-01T00:00:00.000Z'
		} as never);
		expect(info?.coveringFees).toBe(false);
		expect(info?.cancelAtPeriodEnd).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// buildMemberSubscriptionState
// ---------------------------------------------------------------------------
describe('buildMemberSubscriptionState', () => {
	it('stores credits = contribution quantity × 2 and detects fee coverage', async () => {
		const sub = {
			id: 'sub_1',
			cancel_at_period_end: true,
			items: {
				data: [
					{
						price: { product: 'prod_contribution', unit_amount: 500 },
						quantity: 6,
						current_period_end: 1700000000
					},
					{
						price: { product: 'prod_fee', unit_amount: 200 },
						quantity: 1,
						current_period_end: 1700000000
					}
				]
			}
		} as never;

		const state = await buildMemberSubscriptionState(sub, null);
		expect(state).toMatchObject({
			stripeSubscriptionId: 'sub_1',
			hoursPerReset: 12,
			coveringFees: true,
			cancelAtPeriodEnd: true,
			creditsResetAt: new Date(1700000000 * 1000).toISOString()
		});
	});

	it('derives credits from the dollar amount for a flat 1 × $60 line', async () => {
		// Some subscriptions bill a single line (quantity 1) at a flat unit_amount
		// rather than N × $5. $60 must still yield 24 credits (12 hours).
		const sub = {
			id: 'sub_flat',
			cancel_at_period_end: false,
			items: {
				data: [{ price: { product: 'prod_contribution', unit_amount: 6000 }, quantity: 1 }]
			}
		} as never;

		const state = await buildMemberSubscriptionState(sub, null);
		expect(state.hoursPerReset).toBe(24);
	});

	it('preserves existing startedAt for idempotency', async () => {
		const sub = {
			id: 'sub_1',
			cancel_at_period_end: false,
			items: { data: [{ price: { product: 'prod_contribution', unit_amount: 500 }, quantity: 2 }] }
		} as never;

		const state = await buildMemberSubscriptionState(sub, {
			startedAt: '2020-01-01T00:00:00.000Z',
			stripeSubscriptionId: 'sub_1',
			hoursPerReset: 4,
			creditsResetAt: 'x',
			coveringFees: false,
			cancelAtPeriodEnd: false
		});
		expect(state.startedAt).toBe('2020-01-01T00:00:00.000Z');
		expect(state.coveringFees).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// updateQuantity
// ---------------------------------------------------------------------------
describe('updateQuantity', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('updates contribution quantity and adds fee item via price_data', async () => {
		mockStripe.subscriptions.list.mockResolvedValue({
			data: [
				{
					id: 'sub_upd',
					items: {
						data: [
							{
								id: 'si_contrib',
								price: { id: 'price_contribution', product: 'prod_contribution' },
								quantity: 3
							}
						]
					}
				}
			]
		});

		await updateQuantity('cus_123', 7, true);

		expect(mockStripe.subscriptions.update).toHaveBeenCalledWith('sub_upd', {
			items: expect.arrayContaining([
				{
					id: 'si_contrib',
					price_data: expect.objectContaining({
						currency: 'usd',
						product: 'prod_contribution',
						unit_amount: 500,
						recurring: { interval: 'month' }
					}),
					quantity: 7
				},
				expect.objectContaining({
					price_data: expect.objectContaining({
						currency: 'usd',
						product: 'prod_fee',
						recurring: { interval: 'month' }
					}),
					quantity: 1
				})
			])
		});

		// Fee amount should be positive
		const call = mockStripe.subscriptions.update.mock.calls[0][1];
		const feeItem = call.items.find((i: any) => i.price_data);
		expect(feeItem.price_data.unit_amount).toBeGreaterThan(0);
	});

	it('normalizes a legacy flat-priced line so it is not billed at the stale unit price', async () => {
		// Legacy subscriptions billed 1 × full-dollar-amount (unit_amount 6000,
		// quantity 1 = $60). Setting only the quantity to the new $5-unit count (12)
		// while preserving unit_amount 6000 would bill 12 × $60 = $720. The update
		// must restate unit_amount to the $5/unit config price so 12 × $5 = $60.
		mockStripe.subscriptions.list.mockResolvedValue({
			data: [
				{
					id: 'sub_legacy',
					items: {
						data: [
							{
								id: 'si_legacy',
								price: { id: 'price_legacy', product: 'prod_contribution', unit_amount: 6000 },
								quantity: 1
							}
						]
					}
				}
			]
		});

		await updateQuantity('cus_123', 12, false);

		const call = mockStripe.subscriptions.update.mock.calls[0][1];
		const contribItem = call.items.find((i: any) => i.id === 'si_legacy');
		expect(contribItem.price_data.unit_amount).toBe(500);
		expect(contribItem.quantity).toBe(12);
		// Effective monthly charge is $5 × 12 = $60, not the stale $720.
		expect(contribItem.price_data.unit_amount * contribItem.quantity).toBe(6000);
	});

	it('removes existing fee item before adding new one', async () => {
		mockStripe.subscriptions.list.mockResolvedValue({
			data: [
				{
					id: 'sub_replace_fee',
					items: {
						data: [
							{
								id: 'si_contrib',
								price: { id: 'price_contribution', product: 'prod_contribution' },
								quantity: 5
							},
							{ id: 'si_old_fee', price: { id: 'price_old_fee', product: 'prod_fee' }, quantity: 1 }
						]
					}
				}
			]
		});

		await updateQuantity('cus_123', 10, true);

		const call = mockStripe.subscriptions.update.mock.calls[0][1];
		// Should delete old fee item
		expect(call.items).toContainEqual({ id: 'si_old_fee', deleted: true });
		// Should add new fee item with price_data
		const newFee = call.items.find((i: any) => i.price_data);
		expect(newFee).toBeDefined();
	});

	it('deletes a fee line whose product id has drifted instead of appending a duplicate', async () => {
		// After a product-config migration the fee_coverage product id drifts, so the
		// existing fee line carries a stale product ('prod_old_fee') that no longer
		// matches getStripeProductId('fee_coverage') === 'prod_fee'. A strict product-id
		// match misses it: it is never deleted and a fresh fee line is appended, leaving
		// the member billed for TWO "Processing Fee Coverage" lines.
		mockStripe.subscriptions.list.mockResolvedValue({
			data: [
				{
					id: 'sub_drift_fee',
					items: {
						data: [
							{
								id: 'si_contrib',
								price: { id: 'price_contribution', product: 'prod_contribution' },
								quantity: 12
							},
							{
								id: 'si_drifted_fee',
								price: { id: 'price_old', product: 'prod_old_fee' },
								quantity: 1
							}
						]
					}
				}
			]
		});

		await updateQuantity('cus_123', 12, true);

		const call = mockStripe.subscriptions.update.mock.calls[0][1];
		// The drifted fee line must be deleted...
		expect(call.items).toContainEqual({ id: 'si_drifted_fee', deleted: true });
		// ...and exactly one new fee line added — never two.
		const feeLines = call.items.filter((i: any) => i.price_data?.product === 'prod_fee');
		expect(feeLines).toHaveLength(1);
	});

	it('collapses pre-existing duplicate fee lines down to a single line', async () => {
		// A subscription that already accumulated two fee lines (from an earlier drift)
		// must not stay duplicated: every non-contribution line is deleted and one fresh
		// fee line is added.
		mockStripe.subscriptions.list.mockResolvedValue({
			data: [
				{
					id: 'sub_dup_fee',
					items: {
						data: [
							{
								id: 'si_contrib',
								price: { id: 'price_contribution', product: 'prod_contribution' },
								quantity: 12
							},
							{ id: 'si_fee_1', price: { id: 'price_fee_1', product: 'prod_fee' }, quantity: 1 },
							{ id: 'si_fee_2', price: { id: 'price_fee_2', product: 'prod_fee' }, quantity: 1 }
						]
					}
				}
			]
		});

		await updateQuantity('cus_123', 12, true);

		const call = mockStripe.subscriptions.update.mock.calls[0][1];
		expect(call.items).toContainEqual({ id: 'si_fee_1', deleted: true });
		expect(call.items).toContainEqual({ id: 'si_fee_2', deleted: true });
		const feeLines = call.items.filter((i: any) => i.price_data?.product === 'prod_fee');
		expect(feeLines).toHaveLength(1);
	});

	it('deletes every stray fee line when turning coverFees off', async () => {
		mockStripe.subscriptions.list.mockResolvedValue({
			data: [
				{
					id: 'sub_dup_off',
					items: {
						data: [
							{
								id: 'si_contrib',
								price: { id: 'price_contribution', product: 'prod_contribution' },
								quantity: 5
							},
							{ id: 'si_fee_1', price: { id: 'price_fee_1', product: 'prod_fee' }, quantity: 1 },
							{
								id: 'si_drifted_fee',
								price: { id: 'price_old', product: 'prod_old_fee' },
								quantity: 1
							}
						]
					}
				}
			]
		});

		await updateQuantity('cus_123', 5, false);

		const call = mockStripe.subscriptions.update.mock.calls[0][1];
		expect(call.items).toContainEqual({ id: 'si_fee_1', deleted: true });
		expect(call.items).toContainEqual({ id: 'si_drifted_fee', deleted: true });
		// No new fee line is added.
		expect(call.items.some((i: any) => i.price_data?.product === 'prod_fee')).toBe(false);
	});

	it('removes fee item when coverFees is false', async () => {
		mockStripe.subscriptions.list.mockResolvedValue({
			data: [
				{
					id: 'sub_rm_fee',
					items: {
						data: [
							{
								id: 'si_contrib',
								price: { id: 'price_contribution', product: 'prod_contribution' },
								quantity: 5
							},
							{
								id: 'si_fee',
								price: { id: 'price_fee_coverage', product: 'prod_fee' },
								quantity: 1
							}
						]
					}
				}
			]
		});

		await updateQuantity('cus_123', 5, false);

		expect(mockStripe.subscriptions.update).toHaveBeenCalledWith('sub_rm_fee', {
			items: [
				{
					id: 'si_contrib',
					price_data: expect.objectContaining({ unit_amount: 500 }),
					quantity: 5
				},
				{ id: 'si_fee', deleted: true }
			]
		});
	});

	it('throws when no active subscription', async () => {
		mockStripe.subscriptions.list.mockResolvedValue({ data: [] });
		await expect(updateQuantity('cus_ghost', 3, false)).rejects.toThrow(SubscriptionStateError);
	});

	it('throws SubscriptionStateError (not a generic 500) when no usable line item', async () => {
		// Active subscription with no line items at all — nothing to update.
		mockStripe.subscriptions.list.mockResolvedValue({
			data: [{ id: 'sub_empty', items: { data: [] } }]
		});
		await expect(updateQuantity('cus_123', 4, false)).rejects.toBeInstanceOf(
			SubscriptionStateError
		);
	});

	it('updates the contribution line even when its product id has drifted', async () => {
		// Product id no longer matches 'prod_contribution' (e.g. after a product-config
		// migration). The strict match used to throw "Contribution item not found"; the
		// drift-tolerant lookup picks the largest non-fee line instead.
		mockStripe.subscriptions.list.mockResolvedValue({
			data: [
				{
					id: 'sub_drift',
					items: {
						data: [
							{
								id: 'si_legacy_contrib',
								price: { id: 'price_legacy', product: 'prod_legacy_contribution' },
								quantity: 3
							}
						]
					}
				}
			]
		});

		await updateQuantity('cus_123', 8, false);

		// The drifted line is restated under the canonical contribution product and
		// the $5/unit config price, so the quantity always multiplies $5 — not a
		// stale legacy unit price.
		expect(mockStripe.subscriptions.update).toHaveBeenCalledWith('sub_drift', {
			items: [
				{
					id: 'si_legacy_contrib',
					price_data: expect.objectContaining({
						product: 'prod_contribution',
						unit_amount: 500
					}),
					quantity: 8
				}
			]
		});
	});

	it('throws when quantity is less than 1', async () => {
		await expect(updateQuantity('cus_123', 0, false)).rejects.toThrow(SubscriptionValidationError);
	});
});

// ---------------------------------------------------------------------------
// cancel / resume
// ---------------------------------------------------------------------------
describe('cancel', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('sets cancel_at_period_end to true', async () => {
		mockStripe.subscriptions.list.mockResolvedValue({
			data: [{ id: 'sub_cancel', items: { data: [] } }]
		});

		await cancel('cus_123');

		expect(mockStripe.subscriptions.update).toHaveBeenCalledWith('sub_cancel', {
			cancel_at_period_end: true
		});
	});

	it('throws when no active subscription', async () => {
		mockStripe.subscriptions.list.mockResolvedValue({ data: [] });
		await expect(cancel('cus_ghost')).rejects.toThrow(SubscriptionStateError);
	});
});

describe('resume', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('sets cancel_at_period_end to false', async () => {
		mockStripe.subscriptions.list.mockResolvedValue({
			data: [{ id: 'sub_resume', cancel_at_period_end: true, items: { data: [] } }]
		});

		await resume('cus_123');

		expect(mockStripe.subscriptions.update).toHaveBeenCalledWith('sub_resume', {
			cancel_at_period_end: false
		});
	});

	it('throws when subscription is not scheduled for cancellation', async () => {
		mockStripe.subscriptions.list.mockResolvedValue({
			data: [{ id: 'sub_active', cancel_at_period_end: false, items: { data: [] } }]
		});

		await expect(resume('cus_123')).rejects.toThrow(SubscriptionStateError);
	});

	it('throws when no active subscription', async () => {
		mockStripe.subscriptions.list.mockResolvedValue({ data: [] });
		await expect(resume('cus_ghost')).rejects.toThrow(SubscriptionStateError);
	});
});

// ---------------------------------------------------------------------------
// createBillingPortalUrl
// ---------------------------------------------------------------------------
describe('createBillingPortalUrl', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('creates a billing portal session and returns the URL', async () => {
		mockStripe.billingPortal.sessions.create.mockResolvedValue({
			url: 'https://billing.stripe.com/session/abc'
		});

		const url = await createBillingPortalUrl('cus_123', 'https://example.com/return');

		expect(url).toBe('https://billing.stripe.com/session/abc');
		expect(mockStripe.billingPortal.sessions.create).toHaveBeenCalledWith({
			customer: 'cus_123',
			return_url: 'https://example.com/return'
		});
	});

	it('returns null when no customer ID is provided', async () => {
		expect(await createBillingPortalUrl(null, 'https://example.com')).toBeNull();
		expect(await createBillingPortalUrl(undefined, 'https://example.com')).toBeNull();
		expect(mockStripe.billingPortal.sessions.create).not.toHaveBeenCalled();
	});
});
