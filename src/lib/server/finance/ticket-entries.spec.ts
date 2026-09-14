import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The $0 row. The spec's rule is that a free sale still writes one, because
 * "10 tickets, 3 free" and "7 tickets" are different facts and only the row
 * tells them apart.
 */

const recordEntry = vi.fn(async () => undefined);
vi.mock('./financial-entry-service', () => ({
	recordEntry: (...a: unknown[]) => recordEntry(...(a as [])),
	recordEntries: vi.fn()
}));

const { recordFreeTicketSale } = await import('./ticket-entries');

beforeEach(() => vi.clearAllMocks());

describe('free ticket sales', () => {
	it('writes a $0 earned entry that settled nowhere', async () => {
		await recordFreeTicketSale({
			purchaseId: 'free-1',
			eventId: 'evt-1',
			quantity: 3,
			userId: 'user-1',
			occurredAt: new Date('2026-09-13')
		});

		expect(recordEntry).toHaveBeenCalledWith(
			expect.objectContaining({
				amountCents: 0,
				kind: 'earned',
				category: 'ticket_sales',
				// Not cash, not credit, not Stripe — the scale reached zero.
				settlement: 'none',
				subjectType: 'ticket',
				subjectId: 'free-1'
			})
		);
	});

	// How many people a free show reached is the number a funder asks for, and
	// a $0 amount cannot carry it.
	it('carries the count, since the amount cannot', async () => {
		await recordFreeTicketSale({
			purchaseId: 'free-1',
			eventId: 'evt-1',
			quantity: 3,
			occurredAt: new Date('2026-09-13')
		});

		expect(recordEntry).toHaveBeenCalledWith(
			expect.objectContaining({ metadata: { eventId: 'evt-1', quantity: 3 } })
		);
	});

	it('writes for an anonymous claim too', async () => {
		await recordFreeTicketSale({
			purchaseId: 'free-2',
			eventId: 'evt-1',
			quantity: 1,
			occurredAt: new Date('2026-09-13')
		});

		expect(recordEntry).toHaveBeenCalledWith(expect.objectContaining({ userId: null }));
	});
});
