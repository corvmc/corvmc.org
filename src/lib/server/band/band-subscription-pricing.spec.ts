import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetProductConfig = vi.fn();

vi.mock('$lib/server/finance/product-config-service', () => ({
	getProductConfig: (...args: unknown[]) => mockGetProductConfig(...(args as [])),
	buildSubscriptionLineItem: vi.fn(),
	getStripeProductId: vi.fn()
}));

vi.mock('$lib/server/finance/stripe-checkout', () => ({ checkout: vi.fn() }));
vi.mock('$lib/server/db', () => ({ db: {} }));

import { getBandPremiumPricing } from './band-subscription-service';

beforeEach(() => {
	vi.clearAllMocks();
});

/**
 * The upsell page used to hardcode "$15/mo" and "$120/yr" while checkout read
 * the configured price, so editing the price in Staff Settings → Pricing would
 * have left the page quoting one number and the checkout charging another. Both
 * now come from here, and these assertions are what keeps that true.
 */
describe('getBandPremiumPricing', () => {
	it('quotes the configured monthly price', async () => {
		mockGetProductConfig.mockResolvedValue({ unitAmountCents: 500 });

		expect(await getBandPremiumPricing()).toMatchObject({ monthlyCents: 500 });
	});

	// Ten months, not twelve — the two free months are the whole reason yearly is
	// worth offering, and a yearly price of 12x would be a silent price rise.
	it('bills a year at ten months, and says how many are free', async () => {
		mockGetProductConfig.mockResolvedValue({ unitAmountCents: 500 });

		const pricing = await getBandPremiumPricing();

		expect(pricing.yearlyCents).toBe(5000);
		expect(pricing.yearlyMonthsFree).toBe(2);
	});

	// The number the page shows has to move with the setting, or the page lies.
	it('tracks a price change rather than pinning the launch price', async () => {
		mockGetProductConfig.mockResolvedValue({ unitAmountCents: 1500 });

		const pricing = await getBandPremiumPricing();

		expect(pricing.monthlyCents).toBe(1500);
		expect(pricing.yearlyCents).toBe(15000);
	});
});
