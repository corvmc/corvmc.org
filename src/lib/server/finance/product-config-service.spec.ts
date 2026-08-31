import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — product config is now backed by KV (getJson/putJson) + Stripe.
// A simple in-memory Map stands in for KV so we can assert what was persisted.
// ---------------------------------------------------------------------------

const kvStore = new Map<string, unknown>();

vi.mock('$lib/server/kv', () => ({
	getJson: vi.fn(async (key: string) => (kvStore.has(key) ? kvStore.get(key) : null)),
	putJson: vi.fn(async (key: string, value: unknown) => {
		kvStore.set(key, value);
	})
}));

const mockStripeProducts = {
	list: vi.fn(),
	create: vi.fn(),
	update: vi.fn()
};
vi.mock('$lib/server/stripe', () => ({
	stripe: { products: mockStripeProducts }
}));

const {
	getProductConfig,
	getAllProductConfigs,
	getStripeProductId,
	buildLineItem,
	updateProductConfig
} = await import('./product-config-service');

const PREFIX = 'product-config:';

beforeEach(() => {
	vi.clearAllMocks();
	kvStore.clear();
	mockStripeProducts.list.mockResolvedValue({ data: [] });
});

// ---------------------------------------------------------------------------
// getProductConfig
// ---------------------------------------------------------------------------

describe('getProductConfig', () => {
	it('returns the stored row when one exists in KV', async () => {
		kvStore.set(`${PREFIX}contribution`, {
			stripeProductId: 'prod_123',
			name: 'Custom Name',
			description: 'Custom desc',
			unitAmountCents: 700,
			unitLabel: 'per unit/month'
		});

		const result = await getProductConfig('contribution');

		expect(result).toEqual({
			key: 'contribution',
			stripeProductId: 'prod_123',
			name: 'Custom Name',
			description: 'Custom desc',
			unitAmountCents: 700,
			unitLabel: 'per unit/month'
		});
	});

	it('seeds from defaults and persists when no KV entry exists', async () => {
		const result = await getProductConfig('contribution');

		expect(result.name).toBe('Monthly Contribution');
		expect(result.unitAmountCents).toBe(500);
		expect(result.stripeProductId).toBeNull();
		// Persisted back to KV (without the key, which is encoded in the KV key).
		expect(kvStore.get(`${PREFIX}contribution`)).toMatchObject({
			name: 'Monthly Contribution',
			unitAmountCents: 500,
			stripeProductId: null
		});
	});
});

describe('getAllProductConfigs', () => {
	it('returns every product, in DEFAULTS order', async () => {
		const all = await getAllProductConfigs();
		expect(all.map((p) => p.key)).toEqual([
			'contribution',
			'fee_coverage',
			'ticket',
			'ticket_contribution',
			'band_premium'
		]);
	});
});

// ---------------------------------------------------------------------------
// getStripeProductId
// ---------------------------------------------------------------------------

describe('getStripeProductId', () => {
	it('returns the cached Stripe product ID without hitting Stripe', async () => {
		kvStore.set(`${PREFIX}contribution`, {
			stripeProductId: 'prod_cached',
			name: 'Monthly Contribution',
			description: null,
			unitAmountCents: 500,
			unitLabel: 'per unit/month'
		});

		const result = await getStripeProductId('contribution');

		expect(result).toBe('prod_cached');
		expect(mockStripeProducts.list).not.toHaveBeenCalled();
		expect(mockStripeProducts.create).not.toHaveBeenCalled();
	});

	it('reuses an existing Stripe product tagged with the key before creating', async () => {
		mockStripeProducts.list.mockResolvedValue({
			data: [
				{ id: 'prod_other', metadata: { corvmc_key: 'ticket' } },
				{ id: 'prod_existing', metadata: { corvmc_key: 'contribution' } }
			]
		});

		const result = await getStripeProductId('contribution');

		expect(result).toBe('prod_existing');
		expect(mockStripeProducts.create).not.toHaveBeenCalled();
		// Cached back to KV
		expect(kvStore.get(`${PREFIX}contribution`)).toMatchObject({
			stripeProductId: 'prod_existing'
		});
	});

	it('creates a Stripe product when none is tagged, then caches the ID', async () => {
		mockStripeProducts.list.mockResolvedValue({ data: [] });
		mockStripeProducts.create.mockResolvedValue({ id: 'prod_new_123' });

		const result = await getStripeProductId('contribution');

		expect(result).toBe('prod_new_123');
		expect(mockStripeProducts.create).toHaveBeenCalledWith(
			expect.objectContaining({
				name: 'Monthly Contribution',
				metadata: { corvmc_key: 'contribution' }
			})
		);
		expect(kvStore.get(`${PREFIX}contribution`)).toMatchObject({
			stripeProductId: 'prod_new_123'
		});
	});
});

// ---------------------------------------------------------------------------
// buildLineItem
// ---------------------------------------------------------------------------

describe('buildLineItem', () => {
	it('returns a line item with inline price_data', async () => {
		kvStore.set(`${PREFIX}ticket`, {
			stripeProductId: 'prod_ticket',
			name: 'Event Ticket',
			description: null,
			unitAmountCents: 0,
			unitLabel: 'per ticket'
		});

		const item = await buildLineItem('ticket', 1500, 2);

		expect(item).toEqual({
			price_data: {
				currency: 'usd',
				product: 'prod_ticket',
				unit_amount: 1500
			},
			quantity: 2
		});
	});
});

// ---------------------------------------------------------------------------
// updateProductConfig
// ---------------------------------------------------------------------------

describe('updateProductConfig', () => {
	it('writes updated values to KV and syncs to Stripe when product exists', async () => {
		kvStore.set(`${PREFIX}contribution`, {
			stripeProductId: 'prod_123',
			name: 'Old Name',
			description: 'Old desc',
			unitAmountCents: 500,
			unitLabel: 'per unit/month'
		});

		const result = await updateProductConfig('contribution', {
			name: 'New Name',
			description: 'New desc',
			unitAmountCents: 800
		});

		expect(result).toMatchObject({
			name: 'New Name',
			description: 'New desc',
			unitAmountCents: 800
		});
		expect(kvStore.get(`${PREFIX}contribution`)).toMatchObject({
			name: 'New Name',
			unitAmountCents: 800
		});
		expect(mockStripeProducts.update).toHaveBeenCalledWith('prod_123', {
			name: 'New Name',
			description: 'New desc'
		});
	});

	it('skips Stripe sync when no Stripe product exists yet', async () => {
		kvStore.set(`${PREFIX}contribution`, {
			stripeProductId: null,
			name: 'Old',
			description: null,
			unitAmountCents: 500,
			unitLabel: 'per unit/month'
		});

		await updateProductConfig('contribution', { name: 'Updated' });

		expect(mockStripeProducts.update).not.toHaveBeenCalled();
		expect(kvStore.get(`${PREFIX}contribution`)).toMatchObject({ name: 'Updated' });
	});

	it('skips Stripe sync when name/description are unchanged', async () => {
		kvStore.set(`${PREFIX}contribution`, {
			stripeProductId: 'prod_123',
			name: 'Same',
			description: 'Same',
			unitAmountCents: 500,
			unitLabel: 'per unit/month'
		});

		await updateProductConfig('contribution', { unitAmountCents: 2000 });

		expect(mockStripeProducts.update).not.toHaveBeenCalled();
		expect(kvStore.get(`${PREFIX}contribution`)).toMatchObject({ unitAmountCents: 2000 });
	});
});
