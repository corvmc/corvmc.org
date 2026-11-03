import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The two purchase paths, and the places where money could go wrong, against a
 * real SQLite. A **free** release never touches Stripe: Stripe's charge minimum
 * is 50¢, so a $0 checkout does not exist.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

// better-sqlite3's drizzle has no `batch`; D1's runs the statements in order, as this does.
vi.mock('$lib/server/db', () => ({
	db: Object.assign(testDb, {
		batch: async (stmts: PromiseLike<unknown>[]) => {
			const out = [];
			for (const s of stmts) out.push(await s);
			return out;
		}
	})
}));

// Stripe, reached through checkout() and the refunds API, is the outside service.
const checkout = vi.fn(async (_opts: unknown) => ({
	paid: false,
	checkoutUrl: 'https://checkout.test/s'
}));
vi.mock('$lib/server/finance/payment-service', () => ({ checkout }));
vi.mock('$lib/server/finance/product-config-service', () => ({
	getStripeProductId: async (key: string) => `prod_${key}`
}));
const refundsCreate = vi.fn(async (_args: unknown) => ({ id: 're_1' }));
vi.mock('$lib/server/stripe', () => ({ stripe: { refunds: { create: refundsCreate } } }));

const emit = vi.fn(async (..._a: unknown[]) => {});
vi.mock('$lib/server/event-bus/event-bus', () => ({ domainEvents: { emit } }));

const service = await import('./purchase-service');

const T0 = 1_750_000_000;

function seedRelease(opts: { priceMinCents?: number; status?: string; deletedAt?: number } = {}) {
	sqlite.exec(
		`insert into "group" (id, kind, name, slug) values ('band-1', 'band', 'Sour Cherry', 'sour-cherry')`
	);
	sqlite
		.prepare(
			`insert into audio_release (id, group_id, title, slug, status, price_min_cents, allow_pay_more, deleted_at)
			 values ('rel-1', 'band-1', 'Marys Peak', 'marys-peak', ?, ?, 1, ?)`
		)
		.run(opts.status ?? 'published', opts.priceMinCents ?? 1000, opts.deletedAt ?? null);
}

function connectBand(chargesEnabled = true) {
	sqlite
		.prepare(
			`insert into band_stripe_account (group_id, stripe_account_id, charges_enabled) values ('band-1', 'acct_band', ?)`
		)
		.run(chargesEnabled ? 1 : 0);
}

function purchase(
	purchaseId: string,
	opts: { status?: string; amount?: number; pi?: string | null; createdAt?: number } = {}
) {
	sqlite
		.prepare(
			`insert into release_purchase (id, release_id, buyer_email, purchase_id, amount_paid_cents,
			   platform_fee_cents, band_net_cents, download_token, status, stripe_payment_intent_id, created_at)
			 values (?, 'rel-1', 'b@example.com', ?, ?, 94, 847, ?, ?, ?, ?)`
		)
		.run(
			`row-${purchaseId}`,
			purchaseId,
			opts.amount ?? 1000,
			`tok-${purchaseId}`,
			opts.status ?? 'paid',
			opts.pi === undefined ? 'pi_live' : opts.pi,
			opts.createdAt ?? T0
		);
}

const purchases = () =>
	sqlite.prepare('select * from release_purchase order by purchase_id').all() as Record<
		string,
		unknown
	>[];

const BASE = {
	bandSlug: 'sour-cherry',
	releaseSlug: 'marys-peak',
	buyerEmail: 'buyer@example.com',
	downloadToken: 'tok_abc123def456',
	successUrl: 'https://cmc.test/music/download/tok_abc123def456',
	cancelUrl: 'https://cmc.test/music/sour-cherry/marys-peak'
};
const PAID = { ...BASE, totalCents: 1000, platformCents: 94, coverFees: false };
const FREE = { ...BASE, totalCents: 0, platformCents: 0, coverFees: false };

type CheckoutOptions = {
	destinationAccountId: string;
	applicationFeeCents: number;
	eligibleCredits: unknown[];
	coverFees: boolean;
	lineItems: { price_data: { unit_amount: number } }[];
};
const checkoutOptions = () => checkout.mock.calls[0][0] as CheckoutOptions;

beforeEach(() => {
	vi.clearAllMocks();
	for (const t of [
		'financial_entry',
		'release_purchase',
		'band_stripe_account',
		'audio_release',
		'"group"'
	])
		sqlite.exec(`delete from ${t}`);
});

describe('beginPurchase — a free release', () => {
	beforeEach(() => seedRelease({ priceMinCents: 0 }));

	it('never calls Stripe and is paid on the spot', async () => {
		const result = await service.beginPurchase(FREE);

		expect(checkout).not.toHaveBeenCalled();
		expect(result).toMatchObject({ paid: true });
		expect(result.checkoutUrl).toBeUndefined();
		expect(purchases()).toEqual([
			expect.objectContaining({ status: 'paid', amount_paid_cents: 0, release_id: 'rel-1' })
		]);
	});

	it('does not require the band to have Stripe at all', async () => {
		// A band with no bank details can still put a record out.
		await expect(service.beginPurchase(FREE)).resolves.toMatchObject({ paid: true });
	});

	it('emits the receipt, which is a guest’s only copy of the link', async () => {
		await service.beginPurchase(FREE);
		expect(emit).toHaveBeenCalledWith(
			'audio.purchased',
			expect.objectContaining({
				downloadToken: BASE.downloadToken,
				releaseTitle: 'Marys Peak',
				bandSlug: 'sour-cherry'
			})
		);
	});
});

describe('beginPurchase — a paid release', () => {
	beforeEach(() => seedRelease());

	it('sends Stripe whatever is left of the charge once the band is paid', async () => {
		connectBand();
		await service.beginPurchase(PAID);

		// $10 sale: the band gets $8.47 and Stripe is told $1.53 — of which it
		// takes 59¢ and CMC keeps 94¢.
		expect(checkoutOptions()).toMatchObject({
			destinationAccountId: 'acct_band',
			applicationFeeCents: 153
		});
	});

	it('never applies CMC credits to a payout-destined sale', async () => {
		// A CMC credit would discount the sale out of the band's share.
		connectBand();
		await service.beginPurchase(PAID);
		expect(checkoutOptions().eligibleCredits).toEqual([]);
	});

	it('passes coverFees as false, having already priced it in', async () => {
		connectBand();
		await service.beginPurchase({ ...PAID, coverFees: true });

		// checkout() adds its own fee line when told to, which would charge twice.
		// Two lines instead, so the receipt reads the way the split bar did.
		const options = checkoutOptions();
		expect(options.coverFees).toBe(false);
		expect(options.lineItems.map((l) => l.price_data.unit_amount)).toEqual([1000, 61]);
	});

	it('writes the row pending, before any redirect', async () => {
		// The row must exist before the buyer leaves, or the webhook comes back to nothing.
		connectBand();
		checkout.mockImplementationOnce(async () => {
			expect(purchases()).toEqual([
				expect.objectContaining({ status: 'pending', band_net_cents: 847 })
			]);
			return { paid: false, checkoutUrl: 'https://checkout.test/s' };
		});
		await service.beginPurchase(PAID);
		expect(checkout).toHaveBeenCalledOnce();
	});

	it('refuses when the band cannot be paid', async () => {
		// Stripe can restrict an account after a priced release went up.
		connectBand(false);
		await expect(service.beginPurchase(PAID)).rejects.toThrow(/payouts/i);
		expect(checkout).not.toHaveBeenCalled();
		expect(purchases()).toHaveLength(0);
	});

	it('refuses less than the band asked for, before writing anything', async () => {
		connectBand();
		await expect(
			service.beginPurchase({ ...BASE, totalCents: 500, platformCents: 0, coverFees: false })
		).rejects.toThrow();
		expect(purchases()).toHaveLength(0);
		expect(checkout).not.toHaveBeenCalled();
	});
});

describe('beginPurchase — what is for sale', () => {
	it('refuses a release that is not published', async () => {
		seedRelease({ status: 'draft' });
		connectBand();
		await expect(service.beginPurchase(PAID)).rejects.toThrow(/not available/i);
	});

	it('refuses a deleted release', async () => {
		seedRelease({ deletedAt: T0 });
		connectBand();
		await expect(service.beginPurchase(PAID)).rejects.toThrow(/not available/i);
	});

	it('refuses a release of a deleted band', async () => {
		seedRelease();
		connectBand();
		sqlite.prepare(`update "group" set deleted_at = ?`).run(T0);
		await expect(service.beginPurchase(PAID)).rejects.toThrow(/not available/i);
	});
});

describe('fulfillPurchase', () => {
	beforeEach(() => seedRelease());

	it('flips a pending row, keeps the PaymentIntent, and emits once', async () => {
		purchase('p1', { status: 'pending', pi: null });

		expect(await service.fulfillPurchase('p1', 'pi_9', 'pr_9')).toBe(true);

		// Reversing a transfer is an operation on the charge, not the Payment Record.
		expect(purchases()[0]).toMatchObject({
			status: 'paid',
			stripe_payment_intent_id: 'pi_9',
			stripe_payment_record_id: 'pr_9'
		});
		expect(emit).toHaveBeenCalledTimes(1);
	});

	it('is idempotent — a redelivery sends no second receipt', async () => {
		purchase('p1', { status: 'pending', pi: null });
		await service.fulfillPurchase('p1', 'pi_9', 'pi_9');
		expect(await service.fulfillPurchase('p1', 'pi_9', 'pi_9')).toBe(false);
		expect(emit).toHaveBeenCalledTimes(1);
	});

	it('does not resurrect a refunded purchase', async () => {
		purchase('p1', { status: 'refunded' });
		expect(await service.fulfillPurchase('p1', 'pi_9', 'pi_9')).toBe(false);
		expect(purchases()[0].status).toBe('refunded');
	});
});

describe('sweepAbandonedPurchases', () => {
	it('removes only pending rows past the window, and reports how many', async () => {
		seedRelease();
		const now = new Date((T0 + 2 * 86_400) * 1000);
		purchase('old-pending', { status: 'pending', createdAt: T0 });
		purchase('old-paid', { status: 'paid', createdAt: T0 });
		purchase('fresh-pending', { status: 'pending', createdAt: T0 + 2 * 86_400 - 60 });

		expect(await service.sweepAbandonedPurchases(now)).toBe(1);
		expect(purchases().map((p) => p.purchase_id)).toEqual(['fresh-pending', 'old-paid']);
	});
});

describe('refundPurchase', () => {
	beforeEach(() => seedRelease());

	it('reverses the transfer and the application fee, not just the charge', async () => {
		purchase('p1');
		await service.refundPurchase('p1');

		// Without reverse_transfer the collective refunds out of its own pocket;
		// without refund_application_fee CMC keeps its cut of a sale that did not happen.
		expect(refundsCreate).toHaveBeenCalledWith({
			payment_intent: 'pi_live',
			refund_application_fee: true,
			reverse_transfer: true
		});
	});

	it('marks the row refunded, which is what kills the download', async () => {
		purchase('p1');
		await service.refundPurchase('p1');

		expect(purchases()[0]).toMatchObject({ status: 'refunded', refunded_at: expect.any(Number) });
		expect(await service.findPaidPurchaseByToken('tok-p1')).toBeNull();
	});

	it('is idempotent, so a double-click cannot refund twice', async () => {
		purchase('p1');
		await service.refundPurchase('p1');
		await service.refundPurchase('p1');
		expect(refundsCreate).toHaveBeenCalledOnce();
	});

	it('revokes a free download without calling Stripe', async () => {
		purchase('p1', { amount: 0, pi: null });
		await service.refundPurchase('p1');
		expect(refundsCreate).not.toHaveBeenCalled();
		expect(purchases()[0].status).toBe('refunded');
	});

	it('refuses a paid row with no PaymentIntent rather than silently revoking it', async () => {
		// A lost webhook, not a free download: flipping the status would take the
		// buyer's files while leaving their money with Stripe.
		purchase('p1', { pi: null });
		await expect(service.refundPurchase('p1')).rejects.toThrow(/cannot be refunded automatically/);
		expect(purchases()[0].status).toBe('paid');
	});

	it('refuses a pending purchase', async () => {
		purchase('p1', { status: 'pending' });
		await expect(service.refundPurchase('p1')).rejects.toThrow(/completed purchase/);
		expect(refundsCreate).not.toHaveBeenCalled();
	});

	it('refuses a purchase that does not exist', async () => {
		await expect(service.refundPurchase('nope')).rejects.toThrow(/not found/i);
	});
});
