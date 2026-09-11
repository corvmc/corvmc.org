import { describe, it, expect, vi, beforeEach } from 'vitest';

// `createBandPremiumCheckout` had no coverage at all before the in-house
// checkout migration. These mocks are deliberately this file's own rather than
// shared: a spec's mock set is a fixture, and unioning it with a sibling's
// quietly widens what each one was actually testing.
vi.mock('$lib/server/db', () => ({ db: {} }));
vi.mock('$lib/server/stripe', () => ({ stripe: {} }));

const mockCheckout = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/finance/payment-service', () => ({ checkout: mockCheckout }));

vi.mock('$lib/server/finance/product-config-service', () => ({
	getProductConfig: vi.fn(async () => ({ unitAmountCents: 500 })),
	buildSubscriptionLineItem: vi.fn(async (_key, unitAmount, quantity, interval) => ({
		price_data: {
			currency: 'usd',
			product: 'prod_band_premium',
			unit_amount: unitAmount,
			recurring: { interval: interval ?? 'month' }
		},
		quantity
	}))
}));

const { createBandPremiumCheckout, getBandPremiumPricing } =
	await import('./band-subscription-service');

describe('getBandPremiumPricing', () => {
	it('prices the year at ten months, so the badge and the charge cannot drift', async () => {
		const pricing = await getBandPremiumPricing();

		expect(pricing.monthlyCents).toBe(500);
		expect(pricing.yearlyCents).toBe(5000);
		expect(pricing.yearlyMonthsFree).toBe(2);
	});
});

describe('createBandPremiumCheckout', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockCheckout.mockResolvedValue({
			paid: false,
			checkoutUrl: '/checkout/cs_band',
			clientSecret: 'cs_band_secret'
		});
	});

	const options = {
		bandId: 'band-1',
		stripeCustomerId: 'cus_owner',
		billingInterval: 'monthly' as const,
		successUrl: 'https://example.com/band/x/subscription?success=true',
		cancelUrl: 'https://example.com/band/x/subscription'
	};

	it('asks for the in-app payment page, not checkout.stripe.com', async () => {
		const url = await createBandPremiumCheckout(options);

		expect(mockCheckout).toHaveBeenCalledWith(
			expect.objectContaining({ uiMode: 'elements', mode: 'subscription' })
		);
		expect(url).toBe('/checkout/cs_band');
	});

	it('bills a yearly upgrade once a year at the yearly price', async () => {
		await createBandPremiumCheckout({ ...options, billingInterval: 'yearly' });

		expect(mockCheckout).toHaveBeenCalledWith(
			expect.objectContaining({
				lineItems: [
					expect.objectContaining({
						price_data: expect.objectContaining({
							unit_amount: 5000,
							recurring: { interval: 'year' }
						}),
						quantity: 1
					})
				]
			})
		);
	});

	it('tags the session so the webhook can tell it from a member contribution', async () => {
		await createBandPremiumCheckout(options);

		expect(mockCheckout).toHaveBeenCalledWith(
			expect.objectContaining({
				metadata: { subscription_type: 'band_premium', band_id: 'band-1' },
				// No `userId`, so `checkout()` skips credit application — a member's
				// free practice hours are not currency for a band's page.
				coverFees: false
			})
		);
		expect(mockCheckout.mock.calls[0][0].userId).toBeUndefined();
	});

	it('throws rather than returning nothing when Stripe gives no URL', async () => {
		mockCheckout.mockResolvedValue({ paid: false });

		await expect(createBandPremiumCheckout(options)).rejects.toThrow(
			'Stripe did not return a checkout URL'
		);
	});
});
