import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Market vendor table fees (#1502), against a real SQLite. Money moves through
 * `payment-service`, mocked here: what matters is what is asked of it and what
 * the vendor row says afterwards.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

vi.mock('$lib/server/db', () => ({ db: testDb }));
vi.mock('$lib/server/event-bus/event-bus', () => ({ domainEvents: { emit: vi.fn() } }));

const sent = vi.fn(async (_params: { threadId: string; body: string }) => ({ id: 'msg' }));
vi.mock('$lib/server/inbox/message-service', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/inbox/message-service')>()),
	addOutboundMessage: (params: { threadId: string; body: string }) => sent(params)
}));

const checkout = vi.fn(async (_o: unknown) => ({
	paid: false,
	checkoutUrl: '/checkout/cs_1'
}));
const refund = vi.fn(async (_o: unknown) => undefined);
vi.mock('$lib/server/finance/payment-service', () => ({
	checkout: (o: unknown) => checkout(o),
	refund: (o: unknown) => refund(o)
}));
vi.mock('$lib/server/finance/product-config-service', () => ({
	buildLineItem: vi.fn(async (_key: string, unit: number, quantity: number) => ({
		price_data: { currency: 'usd', product: 'prod_market', unit_amount: unit },
		quantity
	}))
}));

const { openMarketDay, getMarketDay, submitApplication, decideApplication } =
	await import('./market-service');
const fees = await import('./vendor-fee-service');
const { marketVendor } = await import('$lib/server/db/schema/market');
const { eq } = await import('drizzle-orm');

const EVENT = 'evt-market';
const NOW = new Date('2026-10-01T12:00:00Z');
const STARTS = new Date('2026-10-20T16:00:00Z');
const ACTOR = { id: 'staff-1', name: 'Sam Staff' };

const application = {
	contactName: 'Rosa Diaz',
	contactEmail: 'rosa@example.com',
	businessName: 'Rosa Ceramics',
	offering: 'Mugs',
	tablesRequested: 2,
	needsPower: false
};

async function vendorRow(id: string) {
	const [row] = await testDb.select().from(marketVendor).where(eq(marketVendor.id, id));
	return row;
}

async function marketWith(fee: { tableFeeCents: number; slidingScale?: boolean; floor?: number }) {
	await openMarketDay(EVENT, {
		applicationsCloseAt: null,
		tableCount: 20,
		tableFeeCents: fee.tableFeeCents,
		slidingScale: fee.slidingScale ?? false,
		slidingScaleFloorCents: fee.floor ?? 0
	});
	const { id } = await submitApplication(EVENT, application, NOW);
	return id;
}

const accept = (id: string) =>
	decideApplication(id, { decision: 'accepted', message: 'You are in.' }, ACTOR);

function paidSession(vendorId: string, amount: number) {
	return {
		id: 'cs_1',
		amount_total: amount,
		payment_intent: 'pi_1',
		metadata: { type: 'market_vendor_fee', vendor_id: vendorId }
	} as never;
}

beforeEach(() => {
	for (const t of [
		'market_vendor',
		'market_day',
		'inbox_message',
		'inbox_thread',
		'event_listing'
	]) {
		sqlite.exec(`delete from ${t}`);
	}
	const s = Math.floor(STARTS.getTime() / 1000);
	sqlite.exec(
		`insert into event_listing (id, title, starts_at, ends_at, status, source, kind, created_by_user_id)
		 values ('${EVENT}', 'Autumn Market', ${s}, ${s + 4 * 3600}, 'published', 'cmc', 'show', 'staff-1')`
	);
	sent.mockClear();
	checkout.mockClear();
	refund.mockClear();
});

describe('the market fee', () => {
	it('is set with the market and read back', async () => {
		await marketWith({ tableFeeCents: 2500, slidingScale: true, floor: 1000 });
		expect(await getMarketDay(EVENT, NOW)).toMatchObject({
			tableFeeCents: 2500,
			slidingScale: true,
			slidingScaleFloorCents: 1000
		});
	});

	it('is fixed on the vendor at acceptance, per table, and the message carries the pay link', async () => {
		const id = await marketWith({ tableFeeCents: 2500 });
		await accept(id);

		expect(await vendorRow(id)).toMatchObject({ feeCents: 5000, feeFloorCents: 5000 });
		expect(sent.mock.calls[0][0].body).toContain(`/market/pay/${id}`);
	});

	it('takes the sliding-scale floor per table too', async () => {
		const id = await marketWith({ tableFeeCents: 2500, slidingScale: true, floor: 500 });
		await accept(id);
		expect(await vendorRow(id)).toMatchObject({ feeCents: 5000, feeFloorCents: 1000 });
	});

	it('owes nothing, and sends no link, on a free market', async () => {
		const id = await marketWith({ tableFeeCents: 0 });
		await accept(id);
		expect(await vendorRow(id)).toMatchObject({ feeCents: 0 });
		expect(sent.mock.calls[0][0].body).toBe('You are in.');
	});
});

describe('paying', () => {
	it('checks out the full fee on a fixed-price market', async () => {
		const id = await marketWith({ tableFeeCents: 2500 });
		await accept(id);

		const result = await fees.startVendorFeeCheckout(id, 5000, 'https://corvmc.org');

		expect(result.checkoutUrl).toBe('/checkout/cs_1');
		expect(checkout).toHaveBeenCalledWith(
			expect.objectContaining({
				mode: 'payment',
				lineItems: [expect.objectContaining({ quantity: 1 })],
				metadata: { type: 'market_vendor_fee', vendor_id: id, event_id: EVENT }
			})
		);
		const { lineItems } = checkout.mock.calls[0][0] as {
			lineItems: { price_data: { unit_amount: number } }[];
		};
		expect(lineItems[0].price_data.unit_amount).toBe(5000);
	});

	it('checks out the whole fee when no amount is named', async () => {
		const id = await marketWith({ tableFeeCents: 2500, slidingScale: true, floor: 500 });
		await accept(id);
		await fees.startVendorFeeCheckout(id, null, 'https://x');
		const { lineItems } = checkout.mock.calls[0][0] as {
			lineItems: { price_data: { unit_amount: number } }[];
		};
		expect(lineItems[0].price_data.unit_amount).toBe(5000);
	});

	it('refuses anything but the fee on a fixed-price market', async () => {
		const id = await marketWith({ tableFeeCents: 2500 });
		await accept(id);
		await expect(fees.startVendorFeeCheckout(id, 1000, 'https://x')).rejects.toBeInstanceOf(
			fees.VendorFeeAmountError
		);
	});

	it('takes any amount between the floor and the fee on a sliding scale', async () => {
		const id = await marketWith({ tableFeeCents: 2500, slidingScale: true, floor: 500 });
		await accept(id);

		await fees.startVendorFeeCheckout(id, 1500, 'https://x');
		await expect(fees.startVendorFeeCheckout(id, 999, 'https://x')).rejects.toBeInstanceOf(
			fees.VendorFeeAmountError
		);
		await expect(fees.startVendorFeeCheckout(id, 5001, 'https://x')).rejects.toBeInstanceOf(
			fees.VendorFeeAmountError
		);
	});

	it('refuses a vendor who is not accepted, owes nothing, or has paid', async () => {
		const id = await marketWith({ tableFeeCents: 2500 });
		await expect(fees.startVendorFeeCheckout(id, 5000, 'https://x')).rejects.toBeInstanceOf(
			fees.VendorFeeNotDueError
		);
		await accept(id);
		await fees.recordVendorFeePaid(paidSession(id, 5000));
		await expect(fees.startVendorFeeCheckout(id, 5000, 'https://x')).rejects.toBeInstanceOf(
			fees.VendorFeeNotDueError
		);
	});

	it('records the payment from the completed checkout, once', async () => {
		const id = await marketWith({ tableFeeCents: 2500 });
		await accept(id);

		await fees.recordVendorFeePaid(paidSession(id, 4000));
		await fees.recordVendorFeePaid(paidSession(id, 9999));

		expect(await vendorRow(id)).toMatchObject({ paidCents: 4000, stripePaymentRecordId: 'pi_1' });
	});

	it('ignores a checkout for anything else', async () => {
		await fees.recordVendorFeePaid({ id: 'cs_x', metadata: { type: 'ticket' } } as never);
		expect(true).toBe(true);
	});
});

describe('refunds when CMC cancels', () => {
	it('refunds a paid vendor that is declined after acceptance', async () => {
		const id = await marketWith({ tableFeeCents: 2500 });
		await accept(id);
		await fees.recordVendorFeePaid(paidSession(id, 5000));

		await decideApplication(id, { decision: 'declined', message: 'Sorry.' }, ACTOR);

		expect(refund).toHaveBeenCalledWith({ stripePaymentRecordId: 'pi_1' });
		expect((await vendorRow(id)).refundedAt).toBeInstanceOf(Date);
	});

	it('refunds nothing for a vendor who had not paid', async () => {
		const id = await marketWith({ tableFeeCents: 2500 });
		await accept(id);
		await decideApplication(id, { decision: 'declined', message: 'Sorry.' }, ACTOR);
		expect(refund).not.toHaveBeenCalled();
	});

	it('refunds every paid vendor when the market is cancelled, and only once', async () => {
		const a = await marketWith({ tableFeeCents: 2500 });
		const b = (await submitApplication(EVENT, { ...application, businessName: 'Other' }, NOW)).id;
		await accept(a);
		await accept(b);
		await fees.recordVendorFeePaid(paidSession(a, 5000));

		expect(await fees.refundMarketFees(EVENT)).toBe(1);
		expect(await fees.refundMarketFees(EVENT)).toBe(0);
		expect(refund).toHaveBeenCalledTimes(1);
	});

	it('asks for the fee again when a refunded vendor is accepted again', async () => {
		const id = await marketWith({ tableFeeCents: 2500 });
		await accept(id);
		await fees.recordVendorFeePaid(paidSession(id, 5000));
		await decideApplication(id, { decision: 'declined', message: 'Sorry.' }, ACTOR);
		await accept(id);

		expect(await vendorRow(id)).toMatchObject({
			paidCents: null,
			refundedAt: null,
			stripePaymentRecordId: null
		});
	});
});
