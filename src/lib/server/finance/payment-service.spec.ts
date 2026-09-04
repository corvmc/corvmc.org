import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock environment
// ---------------------------------------------------------------------------
vi.mock('$env/dynamic/private', () => ({
	env: {
		STRIPE_FEE_PRODUCT_ID: 'prod_fee',
		DATABASE_URL: 'postgres://mock'
	}
}));

// Mock product-config-service to prevent db import chain
vi.mock('./product-config-service', () => ({
	getStripeProductId: vi.fn().mockResolvedValue('prod_fee'),
	getProductConfig: vi.fn().mockResolvedValue({
		key: 'fee_coverage',
		name: 'Fee Coverage',
		description: 'Covers processing fees',
		stripeProductId: 'prod_fee',
		unitAmountCents: 100,
		unitLabel: null
	})
}));

// ---------------------------------------------------------------------------
// Mock Stripe SDK
// ---------------------------------------------------------------------------
const mockStripe = {
	prices: {
		retrieve: vi.fn()
	},
	coupons: {
		create: vi.fn(),
		del: vi.fn()
	},
	checkout: {
		sessions: {
			create: vi.fn(),
			retrieve: vi.fn(),
			list: vi.fn()
		}
	},
	paymentIntents: {
		retrieve: vi.fn()
	},
	refunds: {
		create: vi.fn()
	},
	paymentRecords: {
		reportPayment: vi.fn(),
		retrieve: vi.fn(),
		reportRefund: vi.fn()
	}
};

vi.mock('$lib/server/stripe', () => ({
	stripe: mockStripe
}));

// ---------------------------------------------------------------------------
// Mock CreditService
// ---------------------------------------------------------------------------
const mockCreditService = {
	getBalance: vi.fn(),
	deductCredits: vi.fn(),
	addCredits: vi.fn()
};

vi.mock('./credit-service', () => mockCreditService);

// ---------------------------------------------------------------------------
// Mock DB
// ---------------------------------------------------------------------------
const mockDbInsert = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
const mockDbUpdate = vi.fn().mockReturnValue({
	set: vi.fn().mockReturnValue({
		where: vi.fn().mockResolvedValue(undefined)
	})
});
// refund() reads paymentCache.status to stay idempotent. Default: no cached row.
let paymentCacheRows: unknown[] = [];
const mockDbSelect = vi.fn().mockImplementation(() => ({
	from: () => ({ where: () => ({ limit: () => Promise.resolve(paymentCacheRows) }) })
}));

vi.mock('$lib/server/db', () => ({
	db: {
		insert: (...args: any[]) => mockDbInsert(...args),
		update: (...args: any[]) => mockDbUpdate(...args),
		select: (...args: any[]) => mockDbSelect(...args)
	}
}));

vi.mock('$lib/server/db/schema/finance', () => ({
	paymentCache: { id: 'id' },
	creditTypes: ['free_hours', 'equipment_credits'] as const
}));

vi.mock('drizzle-orm', () => ({
	eq: vi.fn()
}));

// Import after mocking
const { checkout, recordCashPayment, refund, cancel, CheckoutValidationError } =
	await import('./payment-service');

// ---------------------------------------------------------------------------
// checkout()
// ---------------------------------------------------------------------------
describe('checkout', () => {
	const baseOptions = {
		userId: 'user-1',
		stripeCustomerId: 'cus_123',
		mode: 'payment' as const,
		lineItems: [{ price: 'price_abc', quantity: 3 }],
		successUrl: 'https://example.com/success',
		cancelUrl: 'https://example.com/cancel'
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('creates Checkout Session with no credits applied when none eligible', async () => {
		mockStripe.prices.retrieve.mockResolvedValue({ unit_amount: 1000 });
		mockStripe.checkout.sessions.create.mockResolvedValue({
			url: 'https://checkout.stripe.com/sess_123'
		});

		const result = await checkout(baseOptions);

		expect(result).toEqual({ paid: false, checkoutUrl: 'https://checkout.stripe.com/sess_123' });
		expect(mockCreditService.deductCredits).not.toHaveBeenCalled();
		expect(mockStripe.coupons.create).not.toHaveBeenCalled();
		expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(
			expect.objectContaining({
				customer: 'cus_123',
				mode: 'payment',
				line_items: [{ price: 'price_abc', quantity: 3 }],
				metadata: expect.objectContaining({
					user_id: 'user-1',
					credits_applied_cents: '0',
					credits_breakdown: '[]'
				})
			})
		);
	});

	it('applies partial credit discount via coupon', async () => {
		mockStripe.prices.retrieve.mockResolvedValue({ unit_amount: 1000 });
		mockCreditService.getBalance.mockResolvedValue(2);
		mockCreditService.deductCredits.mockResolvedValue(0);
		mockStripe.coupons.create.mockResolvedValue({ id: 'coupon_abc' });
		mockStripe.checkout.sessions.create.mockResolvedValue({
			url: 'https://checkout.stripe.com/sess_456'
		});

		const result = await checkout({
			...baseOptions,
			eligibleCredits: [{ type: 'free_hours', unitValueCents: 1000 }]
		});

		expect(result).toEqual({ paid: false, checkoutUrl: 'https://checkout.stripe.com/sess_456' });
		expect(mockCreditService.deductCredits).toHaveBeenCalledWith(
			'user-1',
			'free_hours',
			2,
			'checkout',
			undefined,
			expect.any(String)
		);
		expect(mockStripe.coupons.create).toHaveBeenCalledWith(
			expect.objectContaining({ amount_off: 2000, currency: 'usd', max_redemptions: 1 })
		);
		expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(
			expect.objectContaining({
				discounts: [{ coupon: 'coupon_abc' }]
			})
		);
	});

	it('returns paid: true when credits fully cover the cart', async () => {
		mockStripe.prices.retrieve.mockResolvedValue({ unit_amount: 1000 });
		mockCreditService.getBalance.mockResolvedValue(5);
		mockCreditService.deductCredits.mockResolvedValue(2);
		mockStripe.paymentRecords.reportPayment.mockResolvedValue({ id: 'pr_credits_only' });

		const result = await checkout({
			...baseOptions,
			eligibleCredits: [{ type: 'free_hours', unitValueCents: 1000 }]
		});

		expect(result).toEqual({ paid: true, stripePaymentRecordId: 'pr_credits_only' });
		expect(mockCreditService.deductCredits).toHaveBeenCalledWith(
			'user-1',
			'free_hours',
			3,
			'checkout',
			undefined,
			expect.any(String)
		);
		expect(mockStripe.paymentRecords.reportPayment).toHaveBeenCalledWith(
			expect.objectContaining({
				amount_requested: { value: 0, currency: 'usd' }
			})
		);
		expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled();
	});

	it('skips credit application for anonymous purchases', async () => {
		mockStripe.checkout.sessions.create.mockResolvedValue({
			url: 'https://checkout.stripe.com/sess_anon'
		});

		const result = await checkout({
			mode: 'payment',
			lineItems: [
				{ price_data: { currency: 'usd', product: 'prod_x', unit_amount: 2000 }, quantity: 1 }
			],
			eligibleCredits: [{ type: 'free_hours', unitValueCents: 1000 }],
			successUrl: 'https://example.com/success',
			cancelUrl: 'https://example.com/cancel'
		});

		expect(result).toEqual({ paid: false, checkoutUrl: 'https://checkout.stripe.com/sess_anon' });
		expect(mockCreditService.getBalance).not.toHaveBeenCalled();
		expect(mockCreditService.deductCredits).not.toHaveBeenCalled();
	});

	it('resolves cart total from price_data inline amounts', async () => {
		mockStripe.checkout.sessions.create.mockResolvedValue({
			url: 'https://checkout.stripe.com/sess_pd'
		});

		await checkout({
			...baseOptions,
			lineItems: [
				{ price_data: { currency: 'usd', product: 'prod_x', unit_amount: 500 }, quantity: 2 },
				{ price_data: { currency: 'usd', product: 'prod_y', unit_amount: 300 }, quantity: 1 }
			]
		});

		// Cart total = 500*2 + 300*1 = 1300
		// No credits, so full amount goes to checkout
		expect(mockStripe.checkout.sessions.create).toHaveBeenCalled();
		expect(mockStripe.prices.retrieve).not.toHaveBeenCalled();
	});

	it('resolves cart total from Stripe price references', async () => {
		mockStripe.prices.retrieve.mockResolvedValue({ unit_amount: 750 });
		mockStripe.checkout.sessions.create.mockResolvedValue({
			url: 'https://checkout.stripe.com/sess_ref'
		});

		await checkout({
			...baseOptions,
			lineItems: [{ price: 'price_xyz', quantity: 4 }]
		});

		expect(mockStripe.prices.retrieve).toHaveBeenCalledWith('price_xyz');
	});

	it('adds fee coverage line item when coverFees is true', async () => {
		mockStripe.prices.retrieve.mockResolvedValue({ unit_amount: 1000 });
		mockStripe.checkout.sessions.create.mockResolvedValue({
			url: 'https://checkout.stripe.com/sess_fee'
		});

		await checkout({
			...baseOptions,
			coverFees: true
		});

		const call = mockStripe.checkout.sessions.create.mock.calls[0][0];
		// Should have original + fee line item
		expect(call.line_items).toHaveLength(2);
		expect(call.line_items[0]).toEqual({ price: 'price_abc', quantity: 3 });
		expect(call.line_items[1].price_data.product).toBe('prod_fee');
		expect(call.line_items[1].price_data.unit_amount).toBeGreaterThan(0);
		expect(call.line_items[1].quantity).toBe(1);
	});

	it('adds recurring interval to fee line item for subscriptions', async () => {
		mockStripe.prices.retrieve.mockResolvedValue({ unit_amount: 500 });
		mockStripe.checkout.sessions.create.mockResolvedValue({
			url: 'https://checkout.stripe.com/sess_sub_fee'
		});

		await checkout({
			...baseOptions,
			mode: 'subscription',
			coverFees: true
		});

		const call = mockStripe.checkout.sessions.create.mock.calls[0][0];
		const feeItem = call.line_items.find((item: any) => item.price_data?.product === 'prod_fee');
		expect(feeItem.price_data.recurring).toEqual({ interval: 'month' });
	});

	it('does not add fee item when coverFees is false', async () => {
		mockStripe.prices.retrieve.mockResolvedValue({ unit_amount: 1000 });
		mockStripe.checkout.sessions.create.mockResolvedValue({
			url: 'https://checkout.stripe.com/sess_nofee'
		});

		await checkout({
			...baseOptions,
			coverFees: false
		});

		const call = mockStripe.checkout.sessions.create.mock.calls[0][0];
		expect(call.line_items).toHaveLength(1);
	});

	it('passes metadata through to Stripe session', async () => {
		mockStripe.prices.retrieve.mockResolvedValue({ unit_amount: 1000 });
		mockStripe.checkout.sessions.create.mockResolvedValue({
			url: 'https://checkout.stripe.com/sess_meta'
		});

		await checkout({
			...baseOptions,
			metadata: { reservation_id: 'res-42', custom_field: 'hello' }
		});

		const call = mockStripe.checkout.sessions.create.mock.calls[0][0];
		expect(call.metadata).toMatchObject({
			reservation_id: 'res-42',
			custom_field: 'hello'
		});
	});

	it('throws when lineItems is empty', async () => {
		await expect(
			checkout({
				...baseOptions,
				lineItems: []
			})
		).rejects.toThrow(CheckoutValidationError);
	});

	it('throws when subscription mode has no customer', async () => {
		await expect(
			checkout({
				mode: 'subscription',
				lineItems: [{ price: 'price_abc', quantity: 1 }],
				successUrl: 'https://example.com/success',
				cancelUrl: 'https://example.com/cancel'
			})
		).rejects.toThrow(CheckoutValidationError);
	});

	it('reverses completed deductions if a subsequent one fails', async () => {
		mockStripe.prices.retrieve.mockResolvedValue({ unit_amount: 5000 });
		mockCreditService.getBalance
			.mockResolvedValueOnce(2) // free_hours
			.mockResolvedValueOnce(1); // equipment_credits
		mockCreditService.deductCredits
			.mockResolvedValueOnce(0) // free_hours succeeds
			.mockRejectedValueOnce(new Error('DB error')); // equipment_credits fails
		mockCreditService.addCredits.mockResolvedValue(2);

		await expect(
			checkout({
				...baseOptions,
				lineItems: [
					{ price_data: { currency: 'usd', product: 'prod_x', unit_amount: 5000 }, quantity: 1 }
				],
				eligibleCredits: [
					{ type: 'free_hours', unitValueCents: 1000 },
					{ type: 'equipment_credits', unitValueCents: 500 }
				]
			})
		).rejects.toThrow('DB error');

		// The successful free_hours deduction should be reversed
		expect(mockCreditService.addCredits).toHaveBeenCalledWith(
			'user-1',
			'free_hours',
			2,
			'checkout_failed',
			undefined,
			expect.any(String)
		);
	});

	it('reverses deductions when session creation fails', async () => {
		mockCreditService.getBalance.mockResolvedValue(1); // free_hours
		mockCreditService.deductCredits.mockResolvedValue(0);
		mockCreditService.addCredits.mockResolvedValue(1);
		mockStripe.coupons.create.mockResolvedValue({ id: 'coup_1' });
		mockStripe.checkout.sessions.create.mockRejectedValue(new Error('Stripe unavailable'));

		await expect(
			checkout({
				...baseOptions,
				lineItems: [
					{ price_data: { currency: 'usd', product: 'prod_x', unit_amount: 5000 }, quantity: 1 }
				],
				eligibleCredits: [{ type: 'free_hours', unitValueCents: 1000 }]
			})
		).rejects.toThrow('Stripe unavailable');

		// The already-deducted credits must come back — otherwise an aborted
		// checkout silently burns them.
		expect(mockCreditService.addCredits).toHaveBeenCalledWith(
			'user-1',
			'free_hours',
			1,
			'checkout_failed',
			undefined,
			expect.any(String)
		);
		// And the orphaned coupon is cleaned up (best-effort).
		expect(mockStripe.coupons.del).toHaveBeenCalledWith('coup_1');
	});

	it('applies whole credit units only, never burning a unit for a partial discount', async () => {
		// Cart 500¢, unit value 1000¢: flooring applies 0 units — the member
		// pays cash and keeps the credit instead of losing 1000¢ of value for
		// a 500¢ discount.
		mockCreditService.getBalance.mockResolvedValue(3);
		mockStripe.checkout.sessions.create.mockResolvedValue({
			url: 'https://checkout.stripe.com/sess_small'
		});

		const result = await checkout({
			...baseOptions,
			lineItems: [
				{ price_data: { currency: 'usd', product: 'prod_x', unit_amount: 500 }, quantity: 1 }
			],
			eligibleCredits: [{ type: 'free_hours', unitValueCents: 1000 }]
		});

		expect(result.paid).toBe(false);
		expect(mockCreditService.deductCredits).not.toHaveBeenCalled();
		expect(mockStripe.coupons.create).not.toHaveBeenCalled();
	});

	it('skips the fee-coverage line for sub-$1 remainders', async () => {
		mockStripe.checkout.sessions.create.mockResolvedValue({
			url: 'https://checkout.stripe.com/sess_tiny'
		});

		await checkout({
			...baseOptions,
			lineItems: [
				{ price_data: { currency: 'usd', product: 'prod_x', unit_amount: 99 }, quantity: 1 }
			],
			coverFees: true
		});

		const params = mockStripe.checkout.sessions.create.mock.calls[0][0];
		expect(params.line_items).toHaveLength(1);
	});

	it('adds the fee-coverage line at $1 and above', async () => {
		mockStripe.checkout.sessions.create.mockResolvedValue({
			url: 'https://checkout.stripe.com/sess_fee'
		});

		await checkout({
			...baseOptions,
			lineItems: [
				{ price_data: { currency: 'usd', product: 'prod_x', unit_amount: 100 }, quantity: 1 }
			],
			coverFees: true
		});

		const params = mockStripe.checkout.sessions.create.mock.calls[0][0];
		expect(params.line_items).toHaveLength(2);
	});

	it('rejects subscription mode with eligible credits (deduction would never discount)', async () => {
		await expect(
			checkout({
				...baseOptions,
				mode: 'subscription',
				eligibleCredits: [{ type: 'free_hours', unitValueCents: 1000 }]
			})
		).rejects.toThrow(CheckoutValidationError);

		expect(mockCreditService.deductCredits).not.toHaveBeenCalled();
		expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// checkout() — ui_mode
// ---------------------------------------------------------------------------
// Stripe rejects success_url/cancel_url outright in `elements` mode and demands
// return_url instead, so the two shapes are mutually exclusive rather than
// additive. Both are asserted here because a caller migrating one flow must not
// be able to change what the other one sends.
// ---------------------------------------------------------------------------
describe('checkout ui_mode', () => {
	const baseOptions = {
		userId: 'user-1',
		stripeCustomerId: 'cus_123',
		mode: 'payment' as const,
		lineItems: [
			{ price_data: { currency: 'usd', product: 'prod_x', unit_amount: 2500 }, quantity: 1 }
		],
		successUrl: 'https://example.com/success',
		cancelUrl: 'https://example.com/cancel'
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('defaults to the hosted page, with success and cancel URLs and no ui_mode', async () => {
		mockStripe.checkout.sessions.create.mockResolvedValue({
			id: 'cs_hosted',
			url: 'https://checkout.stripe.com/sess_hosted'
		});

		const result = await checkout(baseOptions);

		expect(result).toEqual({ paid: false, checkoutUrl: 'https://checkout.stripe.com/sess_hosted' });

		const params = mockStripe.checkout.sessions.create.mock.calls[0][0];
		expect(params.ui_mode).toBeUndefined();
		expect(params.success_url).toBe('https://example.com/success');
		expect(params.cancel_url).toBe('https://example.com/cancel');
		expect(params.return_url).toBeUndefined();
		expect(params.metadata.cancel_url).toBeUndefined();
	});

	it('sends return_url and no success/cancel URL in elements mode', async () => {
		mockStripe.checkout.sessions.create.mockResolvedValue({
			id: 'cs_elements',
			client_secret: 'cs_elements_secret_abc'
		});

		const result = await checkout({ ...baseOptions, uiMode: 'elements' });

		// The in-app page, not checkout.stripe.com — an elements session has no
		// `url` at all, so a caller that still redirects on `checkoutUrl` keeps
		// working without knowing which mode it asked for.
		expect(result).toEqual({
			paid: false,
			checkoutUrl: '/checkout/cs_elements',
			clientSecret: 'cs_elements_secret_abc'
		});

		const params = mockStripe.checkout.sessions.create.mock.calls[0][0];
		expect(params.ui_mode).toBe('elements');
		expect(params.return_url).toBe('https://example.com/success');
		expect(params.success_url).toBeUndefined();
		expect(params.cancel_url).toBeUndefined();
	});

	it('carries the cancel destination in metadata, since the session field is rejected', async () => {
		mockStripe.checkout.sessions.create.mockResolvedValue({
			id: 'cs_elements',
			client_secret: 'cs_elements_secret_abc'
		});

		await checkout({ ...baseOptions, uiMode: 'elements' });

		const params = mockStripe.checkout.sessions.create.mock.calls[0][0];
		expect(params.metadata.cancel_url).toBe('https://example.com/cancel');
	});

	it('keeps the destination charge intact in elements mode', async () => {
		mockStripe.checkout.sessions.create.mockResolvedValue({
			id: 'cs_elements',
			client_secret: 'cs_elements_secret_abc'
		});

		await checkout({
			...baseOptions,
			uiMode: 'elements',
			destinationAccountId: 'acct_band',
			applicationFeeCents: 150
		});

		// `elements` restricts exactly three params — `success_url`, `cancel_url`
		// and `branding_settings` — and `payment_intent_data` is not among them.
		// Record sales pay the band through a destination charge, so this asserts
		// the split survives the migration rather than being quietly dropped.
		const params = mockStripe.checkout.sessions.create.mock.calls[0][0];
		expect(params.ui_mode).toBe('elements');
		expect(params.payment_intent_data.transfer_data).toEqual({ destination: 'acct_band' });
		expect(params.payment_intent_data.application_fee_amount).toBe(150);
	});

	it('throws when an elements session comes back without a client secret', async () => {
		mockStripe.checkout.sessions.create.mockResolvedValue({ id: 'cs_elements' });

		await expect(checkout({ ...baseOptions, uiMode: 'elements' })).rejects.toThrow(
			'Stripe did not return a checkout client secret'
		);
	});

	it('reverses deducted credits when an elements session fails to create', async () => {
		mockCreditService.getBalance.mockResolvedValue(1);
		mockCreditService.deductCredits.mockResolvedValue(0);
		mockStripe.coupons.create.mockResolvedValue({ id: 'coupon_elements' });
		mockStripe.checkout.sessions.create.mockRejectedValue(new Error('stripe down'));

		await expect(
			checkout({
				...baseOptions,
				uiMode: 'elements',
				eligibleCredits: [{ type: 'free_hours', unitValueCents: 1000 }]
			})
		).rejects.toThrow('stripe down');

		expect(mockCreditService.addCredits).toHaveBeenCalled();
		expect(mockStripe.coupons.del).toHaveBeenCalledWith('coupon_elements');
	});
});

// ---------------------------------------------------------------------------
// recordCashPayment()
// ---------------------------------------------------------------------------
describe('recordCashPayment', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('reports payment to Stripe and caches locally', async () => {
		mockStripe.paymentRecords.reportPayment.mockResolvedValue({ id: 'pr_cash_1' });

		const result = await recordCashPayment({
			userId: 'user-1',
			stripeCustomerId: 'cus_123',
			amountCents: 2500,
			metadata: { reservation_id: 'res-5' },
			reference: 'res-5'
		});

		expect(result).toEqual({ paymentRecordId: 'pr_cash_1' });
		expect(mockStripe.paymentRecords.reportPayment).toHaveBeenCalledWith(
			expect.objectContaining({
				amount_requested: { value: 2500, currency: 'usd' },
				metadata: expect.objectContaining({
					reservation_id: 'res-5'
				}),
				customer_details: { customer: 'cus_123' }
			})
		);
		expect(mockDbInsert).toHaveBeenCalled();
	});

	/**
	 * The shape Stripe actually accepts, pinned exactly.
	 *
	 * This call was rejected by the live API on every version tried — `custom`
	 * takes `display_name` *or* `type` and was sent both, and `processor_details`
	 * is required and was absent entirely — which 500'd the request and, on a
	 * loan return, left the loan `checked_out` with the gear already handed back.
	 *
	 * The test above did not catch it and could not have: `objectContaining`
	 * asserts the keys it names and waves through the ones it does not, and a
	 * mocked client agrees with any payload at all. So this asserts the two
	 * sub-objects *exactly*, which is the only form that fails if somebody
	 * reintroduces `custom.type` or drops the processor block.
	 */
	it('sends the payload Stripe accepts: display_name without type, and a processor reference', async () => {
		mockStripe.paymentRecords.reportPayment.mockResolvedValue({ id: 'pr_cash_2' });

		await recordCashPayment({
			userId: 'user-1',
			stripeCustomerId: 'cus_123',
			amountCents: 7000,
			metadata: { equipment_loan_id: 'loan-9' },
			reference: 'loan-9'
		});

		const [payload] = mockStripe.paymentRecords.reportPayment.mock.calls[0];

		expect(payload.payment_method_details).toEqual({
			type: 'custom',
			custom: { display_name: 'Cash' }
		});
		expect(payload.processor_details).toEqual({
			type: 'custom',
			custom: { payment_reference: 'loan-9' }
		});
	});

	it('labels a $0 credit settlement without changing the shape', async () => {
		mockStripe.paymentRecords.reportPayment.mockResolvedValue({ id: 'pr_credits' });

		await recordCashPayment({
			userId: 'user-1',
			stripeCustomerId: 'cus_123',
			amountCents: 0,
			displayName: 'Credits',
			metadata: { reservation_id: 'res-7' },
			reference: 'res-7'
		});

		const [payload] = mockStripe.paymentRecords.reportPayment.mock.calls[0];

		expect(payload.payment_method_details).toEqual({
			type: 'custom',
			custom: { display_name: 'Credits' }
		});
		expect(payload.processor_details.custom.payment_reference).toBe('res-7');
	});
});

// ---------------------------------------------------------------------------
// refund()
// ---------------------------------------------------------------------------
describe('refund', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('refunds card payment and reverses credits', async () => {
		mockStripe.paymentRecords.retrieve.mockResolvedValue({
			amount: { value: 1000 },
			metadata: {
				credits_applied_cents: '2000',
				credits_breakdown: JSON.stringify([{ type: 'free_hours', units: 2, cents: 2000 }])
			}
		});
		mockStripe.paymentRecords.reportRefund.mockResolvedValue({});
		mockCreditService.addCredits.mockResolvedValue(2);

		await refund({
			userId: 'user-1',
			stripePaymentRecordId: 'pr_123'
		});

		expect(mockStripe.paymentRecords.reportRefund).toHaveBeenCalledWith(
			'pr_123',
			expect.objectContaining({ amount: { value: 1000, currency: 'usd' } })
		);
		expect(mockCreditService.addCredits).toHaveBeenCalledWith(
			'user-1',
			'free_hours',
			2,
			'refund',
			'pr_123',
			expect.any(String)
		);
	});

	it('only reverses credits for credits-only payment', async () => {
		mockStripe.paymentRecords.retrieve.mockResolvedValue({
			amount: { value: 0 },
			metadata: {
				credits_applied_cents: '3000',
				credits_breakdown: JSON.stringify([{ type: 'free_hours', units: 3, cents: 3000 }])
			}
		});
		mockCreditService.addCredits.mockResolvedValue(3);

		await refund({
			userId: 'user-1',
			stripePaymentRecordId: 'pr_456'
		});

		expect(mockStripe.paymentRecords.reportRefund).not.toHaveBeenCalled();
		expect(mockCreditService.addCredits).toHaveBeenCalledWith(
			'user-1',
			'free_hours',
			3,
			'refund',
			'pr_456',
			expect.any(String)
		);
	});

	it('skips credit reversal when no userId provided', async () => {
		mockStripe.paymentRecords.retrieve.mockResolvedValue({
			amount: { value: 1500 },
			metadata: {
				credits_applied_cents: '0',
				credits_breakdown: '[]'
			}
		});
		mockStripe.paymentRecords.reportRefund.mockResolvedValue({});

		await refund({
			stripePaymentRecordId: 'pr_anon'
		});

		expect(mockStripe.paymentRecords.reportRefund).toHaveBeenCalled();
		expect(mockCreditService.addCredits).not.toHaveBeenCalled();
	});

	it('does nothing when no credits and no payment amount', async () => {
		mockStripe.paymentRecords.retrieve.mockResolvedValue({
			amount: { value: 0 },
			metadata: {}
		});

		await refund({
			userId: 'user-1',
			stripePaymentRecordId: 'pr_empty'
		});

		expect(mockStripe.paymentRecords.reportRefund).not.toHaveBeenCalled();
		expect(mockCreditService.addCredits).not.toHaveBeenCalled();
	});

	it('refunds a payment intent via Stripe Refunds API', async () => {
		mockStripe.paymentIntents.retrieve.mockResolvedValue({
			amount: 5000,
			status: 'succeeded',
			metadata: {
				credits_breakdown: JSON.stringify([{ type: 'free_hours', units: 1, cents: 1000 }])
			}
		});
		mockStripe.refunds.create.mockResolvedValue({});
		mockCreditService.addCredits.mockResolvedValue(1);

		await refund({
			userId: 'user-1',
			stripePaymentRecordId: 'pi_abc123'
		});

		expect(mockStripe.refunds.create).toHaveBeenCalledWith({ payment_intent: 'pi_abc123' });
		expect(mockStripe.paymentRecords.retrieve).not.toHaveBeenCalled();
		expect(mockCreditService.addCredits).toHaveBeenCalledWith(
			'user-1',
			'free_hours',
			1,
			'refund',
			'pi_abc123',
			expect.any(String)
		);
	});

	it('falls back to checkout session metadata for payment intent credits', async () => {
		mockStripe.paymentIntents.retrieve.mockResolvedValue({
			amount: 3000,
			status: 'succeeded',
			metadata: {}
		});
		mockStripe.refunds.create.mockResolvedValue({});
		mockStripe.checkout.sessions.list.mockResolvedValue({
			data: [
				{
					metadata: {
						credits_breakdown: JSON.stringify([{ type: 'free_hours', units: 2, cents: 2000 }])
					}
				}
			]
		});
		mockCreditService.addCredits.mockResolvedValue(2);

		await refund({
			userId: 'user-1',
			stripePaymentRecordId: 'pi_no_meta'
		});

		expect(mockStripe.checkout.sessions.list).toHaveBeenCalledWith({
			payment_intent: 'pi_no_meta',
			limit: 1
		});
		expect(mockCreditService.addCredits).toHaveBeenCalledWith(
			'user-1',
			'free_hours',
			2,
			'refund',
			'pi_no_meta',
			expect.any(String)
		);
	});

	it('skips refund for non-succeeded payment intent', async () => {
		mockStripe.paymentIntents.retrieve.mockResolvedValue({
			amount: 5000,
			status: 'canceled',
			metadata: {}
		});

		await refund({
			stripePaymentRecordId: 'pi_canceled'
		});

		expect(mockStripe.refunds.create).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// cancel()
// ---------------------------------------------------------------------------
describe('cancel', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('reverses optimistically deducted credits', async () => {
		mockStripe.checkout.sessions.retrieve.mockResolvedValue({
			metadata: {
				credits_applied_cents: '1000',
				credits_breakdown: JSON.stringify([{ type: 'free_hours', units: 1, cents: 1000 }])
			}
		});
		mockCreditService.addCredits.mockResolvedValue(1);

		await cancel({
			userId: 'user-1',
			stripeCheckoutSessionId: 'cs_abandoned'
		});

		expect(mockCreditService.addCredits).toHaveBeenCalledWith(
			'user-1',
			'free_hours',
			1,
			'cancelled',
			'cs_abandoned',
			expect.any(String)
		);
	});

	it('does nothing when no checkout session ID provided', async () => {
		await cancel({
			userId: 'user-1'
		});

		expect(mockStripe.checkout.sessions.retrieve).not.toHaveBeenCalled();
		expect(mockCreditService.addCredits).not.toHaveBeenCalled();
	});

	it('does not reverse credits when the session completed (it was paid, not abandoned)', async () => {
		mockStripe.checkout.sessions.retrieve.mockResolvedValue({
			status: 'complete',
			metadata: {
				credits_applied_cents: '2000',
				credits_breakdown: JSON.stringify([{ type: 'free_hours', units: 2, cents: 2000 }])
			}
		});

		await cancel({ userId: 'user-1', stripeCheckoutSessionId: 'cs_done' });

		expect(mockCreditService.addCredits).not.toHaveBeenCalled();
	});

	it('does nothing when no credits were deducted', async () => {
		mockStripe.checkout.sessions.retrieve.mockResolvedValue({
			metadata: { credits_applied_cents: '0' }
		});

		await cancel({
			userId: 'user-1',
			stripeCheckoutSessionId: 'cs_no_credits'
		});

		expect(mockCreditService.addCredits).not.toHaveBeenCalled();
	});

	it('skips credit reversal when no userId', async () => {
		mockStripe.checkout.sessions.retrieve.mockResolvedValue({
			metadata: {
				credits_breakdown: JSON.stringify([{ type: 'free_hours', units: 1, cents: 1000 }])
			}
		});

		await cancel({
			stripeCheckoutSessionId: 'cs_anon'
		});

		expect(mockCreditService.addCredits).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// refund() idempotency — JAVASCRIPT-SVELTEKIT-29
// ---------------------------------------------------------------------------
// Staff Refund and staff Cancel are separate actions and both reach refund().
// Refund-then-Cancel called Stripe twice; the second raised "Charge ... has
// already been refunded" *after* cancel() had flipped the reservation to
// cancelled, leaving it with credits un-reversed and no cancellation event.
describe('refund idempotency', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		paymentCacheRows = [];
	});

	it('does nothing when the payment is already marked refunded', async () => {
		paymentCacheRows = [{ status: 'refunded' }];

		await refund({ userId: 'user-1', stripePaymentRecordId: 'pi_abc123' });

		expect(mockStripe.paymentIntents.retrieve).not.toHaveBeenCalled();
		expect(mockStripe.refunds.create).not.toHaveBeenCalled();
		// Critically, credits are not reversed a second time — reverseDeductions
		// has no dedupe of its own, so this would double-credit the member.
		expect(mockCreditService.addCredits).not.toHaveBeenCalled();
	});

	it('does not re-refund a charge Stripe already refunded in full', async () => {
		mockStripe.paymentIntents.retrieve.mockResolvedValue({
			id: 'pi_abc123',
			amount: 5000,
			// A PaymentIntent stays `succeeded` after a refund and its `amount` is
			// never decremented, so only the charge reveals the refund.
			status: 'succeeded',
			metadata: {},
			latest_charge: { amount_captured: 5000, amount_refunded: 5000 }
		});

		await refund({ stripePaymentRecordId: 'pi_abc123' });

		expect(mockStripe.refunds.create).not.toHaveBeenCalled();
	});

	it('still refunds when the charge has an outstanding amount', async () => {
		mockStripe.paymentIntents.retrieve.mockResolvedValue({
			id: 'pi_abc123',
			amount: 5000,
			status: 'succeeded',
			metadata: {},
			latest_charge: { amount_captured: 5000, amount_refunded: 0 }
		});
		mockStripe.refunds.create.mockResolvedValue({});

		await refund({ stripePaymentRecordId: 'pi_abc123' });

		expect(mockStripe.refunds.create).toHaveBeenCalledWith({ payment_intent: 'pi_abc123' });
	});
});
