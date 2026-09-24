import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BAND_TICKET_PLATFORM_FEE_BPS, TICKET_COLLECTIVE_SHARE_BPS } from '$lib/config';

// Each `db.select()` resolves to the next queued result, whatever the chain.
let selectQueue: unknown[][] = [];
const updates: { set: Record<string, unknown> }[] = [];

function chain(result: () => unknown[]) {
	const proxy: unknown = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') return (resolve: (v: unknown[]) => void) => resolve(result());
			return () => proxy;
		}
	});
	return proxy;
}

vi.mock('$lib/server/db', () => ({
	db: {
		select: () => chain(() => selectQueue.shift() ?? []),
		update: () => ({
			set: (set: Record<string, unknown>) => {
				updates.push({ set });
				return chain(() => []);
			}
		})
	}
}));

const destinationFor = vi.fn();
vi.mock('$lib/server/audio/connect-service', () => ({
	destinationFor: (...a: unknown[]) => destinationFor(...(a as []))
}));

const recordBandTicketRefund = vi.fn();
vi.mock('$lib/server/finance/ticket-entries', () => ({
	recordBandTicketRefund: (...a: unknown[]) => recordBandTicketRefund(...(a as []))
}));

const refundsCreate = vi.fn();
vi.mock('$lib/server/stripe', () => ({
	stripe: { refunds: { create: (...a: unknown[]) => refundsCreate(...(a as [])) } }
}));

const { sellerFor, refundBandTicketSale } = await import('./ticket-seller');

const cmcShow = { id: 'evt-1', source: 'cmc', groupId: null, ticketingEnabled: true };
const bandGig = { id: 'evt-2', source: 'band', groupId: 'band-1', ticketingEnabled: true };

beforeEach(() => {
	selectQueue = [];
	updates.length = 0;
	destinationFor.mockReset();
	refundsCreate.mockReset();
	recordBandTicketRefund.mockReset();
});

describe('sellerFor', () => {
	it('sells nothing that is not on sale', async () => {
		expect(await sellerFor({ ...cmcShow, ticketingEnabled: false })).toBeNull();
	});

	it('sells a CMC show as the collective, at the show split', async () => {
		selectQueue = [[{ groupId: null }]];
		expect(await sellerFor(cmcShow)).toEqual({
			kind: 'collective',
			shareBps: TICKET_COLLECTIVE_SHARE_BPS
		});
	});

	it('never sells a band gig as the collective', async () => {
		selectQueue = [[{ groupId: null }]];
		expect(await sellerFor(bandGig)).toBeNull();
	});

	it('sells a premium band gig to the band’s own account, at the band split', async () => {
		selectQueue = [[{ groupId: 'band-1' }], [{ tier: 'premium' }]];
		destinationFor.mockResolvedValue('acct_band');
		expect(await sellerFor(bandGig)).toEqual({
			kind: 'band',
			groupId: 'band-1',
			destinationAccountId: 'acct_band',
			shareBps: BAND_TICKET_PLATFORM_FEE_BPS
		});
	});

	it('closes a band sale once the band is no longer premium', async () => {
		selectQueue = [[{ groupId: 'band-1' }], [{ tier: 'free' }]];
		destinationFor.mockResolvedValue('acct_band');
		expect(await sellerFor(bandGig)).toBeNull();
	});

	it('closes a band sale while the band cannot take charges', async () => {
		selectQueue = [[{ groupId: 'band-1' }], [{ tier: 'premium' }]];
		destinationFor.mockResolvedValue(null);
		expect(await sellerFor(bandGig)).toBeNull();
	});

	it('refuses a seller that is not the band that owns the listing', async () => {
		selectQueue = [[{ groupId: 'band-other' }], [{ tier: 'premium' }]];
		destinationFor.mockResolvedValue('acct_other');
		expect(await sellerFor(bandGig)).toBeNull();
	});
});

describe('refundBandTicketSale', () => {
	it('reverses both shares of every paid purchase, once each', async () => {
		selectQueue = [
			[{ groupId: 'band-1' }],
			[
				{ purchaseId: 'p1', paymentRef: 'pi_1' },
				{ purchaseId: 'p1', paymentRef: 'pi_1' },
				{ purchaseId: 'p2', paymentRef: 'pi_2' }
			]
		];

		const result = await refundBandTicketSale('evt-2');

		expect(refundsCreate).toHaveBeenCalledTimes(2);
		expect(refundsCreate).toHaveBeenCalledWith(
			{ payment_intent: 'pi_1', reverse_transfer: true, refund_application_fee: true },
			{ idempotencyKey: 'band-ticket-refund-p1' }
		);
		expect(result).toEqual({ refunded: 2 });
		expect(updates.every((u) => u.set.status === 'cancelled')).toBe(true);
		// The ledger follows the money back.
		expect(recordBandTicketRefund).toHaveBeenCalledWith('p1');
		expect(recordBandTicketRefund).toHaveBeenCalledWith('p2');
	});

	it('cancels a free claim without calling Stripe', async () => {
		selectQueue = [[{ groupId: 'band-1' }], [{ purchaseId: 'free-1', paymentRef: null }]];

		const result = await refundBandTicketSale('evt-2');

		expect(refundsCreate).not.toHaveBeenCalled();
		expect(result).toEqual({ refunded: 0 });
		expect(updates).toHaveLength(1);
	});

	it('leaves a collective sale to staff', async () => {
		selectQueue = [[{ groupId: null }]];

		expect(await refundBandTicketSale('evt-1')).toEqual({ refunded: 0 });
		expect(refundsCreate).not.toHaveBeenCalled();
		expect(updates).toHaveLength(0);
	});
});
