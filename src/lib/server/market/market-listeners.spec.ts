import { describe, it, expect, vi, beforeEach } from 'vitest';

type Handler = (e: { data: unknown }) => Promise<void>;
const handlers: Record<string, Handler[]> = {};
vi.mock('$lib/server/event-bus/event-bus', () => ({
	domainEvents: {
		on: (name: string, fn: Handler) => (handlers[name] ??= []).push(fn)
	}
}));

const refundMarketFees = vi.fn(async () => 0);
vi.mock('./vendor-fee-service', () => ({
	refundMarketFees: (...a: unknown[]) => refundMarketFees(...(a as []))
}));

const captureException = vi.fn();
vi.mock('$lib/server/sentry', () => ({ captureException: (e: unknown) => captureException(e) }));

const { registerMarketListeners } = await import('./market-listeners');
registerMarketListeners();

beforeEach(() => vi.clearAllMocks());

describe('market listeners', () => {
	it('refunds the fees of a cancelled market', async () => {
		await handlers['event.cancelled'][0]({ data: { eventId: 'evt-1' } });
		expect(refundMarketFees).toHaveBeenCalledWith('evt-1');
	});

	it('reports a failed refund rather than failing the cancellation', async () => {
		refundMarketFees.mockRejectedValueOnce(new Error('Stripe is down'));
		await handlers['event.cancelled'][0]({ data: { eventId: 'evt-1' } });
		expect(captureException).toHaveBeenCalled();
	});
});
