import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The two purchase paths, and the places where money could go wrong.
 *
 * The one worth stating up front: a **free** release never touches Stripe.
 * Stripe's own charge minimum is 50¢, so a $0 checkout is not a thing that
 * exists, and a code path that tried would fail at the redirect rather than
 * here.
 */

type Row = Record<string, unknown>;

const state = {
	results: [] as unknown[][],
	inserted: [] as Row[],
	updates: [] as Row[]
};

function queue(...results: unknown[][]) {
	state.results = results;
}

function chain(rows: unknown[]) {
	const self: Record<string, unknown> = {};
	for (const key of ['from', 'where', 'orderBy', 'limit', 'innerJoin', 'leftJoin']) {
		self[key] = () => self;
	}
	self.then = (resolve: (v: unknown) => void) => resolve(rows);
	return self;
}

vi.mock('$lib/server/db', () => ({
	db: {
		select: () => chain(state.results.shift() ?? []),
		insert: () => ({
			values: (v: Row) => {
				state.inserted.push(v);
				return { returning: () => Promise.resolve([{ id: 'purchase-row', ...v }]) };
			}
		}),
		update: () => ({
			set: (v: Row) => ({
				where: () => {
					state.updates.push(v);
					// One lazy take, so `returning()` and an await do not consume two
					// queued results for one statement.
					let rows: unknown[] | null = null;
					const take = () => (rows ??= state.results.shift() ?? []);
					return {
						returning: () => Promise.resolve(take()),
						then: (resolve: (x: unknown) => void) => resolve(take())
					};
				}
			})
		}),
		delete: () => ({
			where: () => ({ returning: () => Promise.resolve(state.results.shift() ?? []) })
		})
	}
}));

vi.mock('drizzle-orm', () => ({
	and: (...p: unknown[]) => `and(${p.join(',')})`,
	count: () => 'count()',
	eq: (a: unknown, b: unknown) => `eq(${String(a)},${String(b)})`,
	lt: (a: unknown, b: unknown) => `lt(${String(a)},${String(b)})`,
	sql: Object.assign(
		(strings: TemplateStringsArray, ...values: unknown[]) =>
			strings.raw.join('?') + values.map(String).join(''),
		{ raw: (s: string) => s }
	)
}));

const checkout = vi.fn(async () => ({ paid: false, checkoutUrl: 'https://checkout.test/s' }));
vi.mock('$lib/server/finance/payment-service', () => ({ checkout }));
vi.mock('$lib/server/finance/product-config-service', () => ({
	getStripeProductId: async (key: string) => `prod_${key}`
}));

const destinationFor = vi.fn(async () => 'acct_band' as string | null);
vi.mock('./connect-service', () => ({ destinationFor }));

const emit = vi.fn(async () => {});
vi.mock('$lib/server/event-bus/event-bus', () => ({ domainEvents: { emit } }));

const service = await import('./purchase-service');

/** A published, $10, name-your-price release owned by a band with Stripe live. */
function publishedRelease(overrides: Record<string, unknown> = {}) {
	return [
		{
			release: {
				id: 'rel-1',
				priceMinCents: 1000,
				allowPayMore: true,
				...overrides
			},
			bandId: 'band-1',
			bandName: 'Sour Cherry'
		}
	];
}

const BASE = {
	bandSlug: 'sour-cherry',
	releaseSlug: 'marys-peak',
	buyerEmail: 'buyer@example.com',
	downloadToken: 'tok_abc123def456',
	successUrl: 'https://cmc.test/music/download/tok_abc123def456',
	cancelUrl: 'https://cmc.test/music/sour-cherry/marys-peak'
};

beforeEach(() => {
	vi.clearAllMocks();
	state.results = [];
	state.inserted = [];
	state.updates = [];
	destinationFor.mockResolvedValue('acct_band');
	checkout.mockResolvedValue({ paid: false, checkoutUrl: 'https://checkout.test/s' });
});

describe('beginPurchase — a free release', () => {
	it('never calls Stripe and is paid on the spot', async () => {
		queue(publishedRelease({ priceMinCents: 0 }));
		const result = await service.beginPurchase({
			...BASE,
			totalCents: 0,
			platformCents: 0,
			coverFees: false
		});

		expect(checkout).not.toHaveBeenCalled();
		expect(result.paid).toBe(true);
		expect(result.checkoutUrl).toBeUndefined();
		expect(state.inserted[0]).toMatchObject({ status: 'paid', amountPaidCents: 0 });
	});

	it('does not require the band to have Stripe at all', async () => {
		// The path that lets a band with no bank details still put a record out and
		// still be on the radio.
		destinationFor.mockResolvedValue(null);
		queue(publishedRelease({ priceMinCents: 0 }));

		await expect(
			service.beginPurchase({ ...BASE, totalCents: 0, platformCents: 0, coverFees: false })
		).resolves.toMatchObject({ paid: true });
		expect(destinationFor).not.toHaveBeenCalled();
	});

	it('emits the receipt, which is a guest’s only copy of the link', async () => {
		queue(publishedRelease({ priceMinCents: 0 }), [
			{
				purchase: {
					purchaseId: 'p1',
					downloadToken: BASE.downloadToken,
					buyerEmail: BASE.buyerEmail,
					amountPaidCents: 0,
					platformFeeCents: 0,
					bandNetCents: 0
				},
				releaseTitle: 'Marys Peak',
				releaseSlug: 'marys-peak',
				bandName: 'Sour Cherry',
				bandSlug: 'sour-cherry'
			}
		]);
		await service.beginPurchase({
			...BASE,
			totalCents: 0,
			platformCents: 0,
			coverFees: false
		});
		expect(emit).toHaveBeenCalledWith(
			'audio.purchased',
			expect.objectContaining({ downloadToken: BASE.downloadToken })
		);
	});
});

describe('beginPurchase — a paid release', () => {
	it('sends Stripe whatever is left of the charge once the band is paid', async () => {
		queue(publishedRelease());
		await service.beginPurchase({
			...BASE,
			totalCents: 1000,
			platformCents: 94,
			coverFees: false
		});

		const [options] = checkout.mock.calls[0] as unknown as [Record<string, unknown>];
		expect(options.destinationAccountId).toBe('acct_band');
		// $10 sale. Card processing comes off the top, so the buyer's 10% is 94¢
		// of the $9.41 that is divisible; the band is transferred $8.47 and
		// Stripe is told $1.53 — out of which it takes 59¢ and CMC keeps 94¢.
		expect(options.applicationFeeCents).toBe(153);
	});

	it('never applies CMC credits to a payout-destined sale', async () => {
		queue(publishedRelease());
		await service.beginPurchase({
			...BASE,
			totalCents: 1000,
			platformCents: 94,
			coverFees: false
		});
		const [options] = checkout.mock.calls[0] as unknown as [{ eligibleCredits: unknown[] }];
		// A CMC credit here would be the collective discounting a sale out of the
		// band's share — the coupon comes off the charge, the app fee does not move.
		expect(options.eligibleCredits).toEqual([]);
	});

	it('passes coverFees as false, having already priced it in', async () => {
		queue(publishedRelease());
		await service.beginPurchase({
			...BASE,
			totalCents: 1000,
			platformCents: 94,
			coverFees: true
		});

		const [options] = checkout.mock.calls[0] as unknown as [
			{ coverFees: boolean; lineItems: { price_data: { unit_amount: number } }[] }
		];
		// `checkout()` adds its own fee line when told to. The surcharge is already
		// in the split, so letting it would charge the buyer twice.
		expect(options.coverFees).toBe(false);
		// Two lines instead: the record, then the coverage, so the receipt reads
		// the way the split bar did.
		expect(options.lineItems).toHaveLength(2);
		expect(options.lineItems[0].price_data.unit_amount).toBe(1000);
		expect(options.lineItems[1].price_data.unit_amount).toBe(61);
	});

	it('writes the row pending, before any redirect', async () => {
		queue(publishedRelease());
		await service.beginPurchase({
			...BASE,
			totalCents: 1000,
			platformCents: 94,
			coverFees: false
		});
		// The row has to exist before the buyer leaves, or the webhook comes back
		// to nothing.
		// The band's allocation less its proportional share of the card fee.
		expect(state.inserted[0]).toMatchObject({ status: 'pending', bandNetCents: 847 });
	});

	it('refuses when the band cannot be paid', async () => {
		// Checked at purchase, not only at publish: Stripe can restrict an account
		// after a priced release went up.
		destinationFor.mockResolvedValue(null);
		queue(publishedRelease());

		await expect(
			service.beginPurchase({ ...BASE, totalCents: 1000, platformCents: 94, coverFees: false })
		).rejects.toThrow(/payouts/i);
		expect(checkout).not.toHaveBeenCalled();
	});

	it('refuses less than the band asked for, before writing anything', async () => {
		queue(publishedRelease());
		await expect(
			service.beginPurchase({ ...BASE, totalCents: 500, platformCents: 0, coverFees: false })
		).rejects.toThrow();
		expect(state.inserted).toHaveLength(0);
		expect(checkout).not.toHaveBeenCalled();
	});

	it('refuses a release that is not published', async () => {
		// The lookup itself filters on status, so a draft is simply not found —
		// publication is checked as part of resolving it rather than after.
		queue([]);
		await expect(
			service.beginPurchase({ ...BASE, totalCents: 1000, platformCents: 94, coverFees: false })
		).rejects.toThrow(/not available/i);
	});
});

describe('fulfillPurchase', () => {
	it('flips a pending row and emits once', async () => {
		queue(
			[{ id: 'purchase-row' }],
			[
				{
					purchase: {
						purchaseId: 'p1',
						downloadToken: 't',
						buyerEmail: 'b@example.com',
						amountPaidCents: 1000,
						platformFeeCents: 94,
						bandNetCents: 847
					},
					releaseTitle: 'R',
					releaseSlug: 'r',
					bandName: 'B',
					bandSlug: 'b'
				}
			]
		);
		expect(await service.fulfillPurchase('p1', 'pi_1', 'pi_1')).toBe(true);
		expect(emit).toHaveBeenCalledTimes(1);
	});

	it('is idempotent — a redelivery sends no second receipt', async () => {
		// Stripe redelivers. The status predicate in the UPDATE is what makes the
		// second pass match nothing.
		queue([]);
		expect(await service.fulfillPurchase('p1', 'pi_1', 'pi_1')).toBe(false);
		expect(emit).not.toHaveBeenCalled();
	});

	it('keeps the PaymentIntent id, which a Connect refund needs', async () => {
		queue([{ id: 'purchase-row' }], []);
		await service.fulfillPurchase('p1', 'pi_9', 'pi_9');
		// Reversing a transfer and refunding an application fee are operations on
		// the charge, not on the Payment Record describing it.
		expect(state.updates[0]).toMatchObject({ stripePaymentIntentId: 'pi_9', status: 'paid' });
	});
});

describe('sweepAbandonedPurchases', () => {
	it('reports what it removed', async () => {
		queue([{ id: 'a' }, { id: 'b' }]);
		expect(await service.sweepAbandonedPurchases()).toBe(2);
	});
});
