import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The $0 row. The spec's rule is that a free sale still writes one, because
 * "10 tickets, 3 free" and "7 tickets" are different facts and only the row
 * tells them apart.
 */

const recordEntry = vi.fn(async () => undefined);
const reverseEntriesForSubject = vi.fn(async () => 2);
const recordEntries = vi.fn(async () => undefined);
vi.mock('./financial-entry-service', () => ({
	recordEntry: (...a: unknown[]) => recordEntry(...(a as [])),
	recordEntries: (...a: unknown[]) => recordEntries(...(a as [])),
	reverseEntriesForSubject: (...a: unknown[]) => reverseEntriesForSubject(...(a as []))
}));

const { recordFreeTicketSale, recordBandTicketRefund, recordDoorTicketSale } =
	await import('./ticket-entries');

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

describe('a band ticket refund (#1472)', () => {
	it('reverses what the sale wrote, keyed on the purchase', async () => {
		await recordBandTicketRefund('tkt-2');
		expect(reverseEntriesForSubject).toHaveBeenCalledWith('ticket', 'tkt-2');
	});
});

describe('door ticket sales', () => {
	const sale = {
		purchaseId: 'pi_door_1',
		eventId: 'evt-1',
		chargeCents: 3000,
		actsCents: 2000,
		collectiveCents: 914,
		feeCents: 86,
		occurredAt: new Date('2026-09-24')
	};

	it('writes the rows an online sale writes, settled through Stripe', async () => {
		await recordDoorTicketSale(sale);
		const [[entries]] = recordEntries.mock.calls as unknown as [[Record<string, unknown>[]]];
		expect(entries.map((e) => [e.category, e.amountCents])).toEqual([
			['ticket_sales', 914],
			['act_payout', 2000],
			['card_fees', -86]
		]);
		for (const entry of entries) {
			expect(entry).toMatchObject({
				settlement: 'stripe',
				stripePaymentRecordId: 'pi_door_1',
				subjectType: 'ticket',
				subjectId: 'pi_door_1'
			});
		}
	});

	it('reconciles: what the rows add to is what the card was charged', async () => {
		await recordDoorTicketSale(sale);
		const [[entries]] = recordEntries.mock.calls as unknown as [[{ amountCents: number }[]]];
		const earned = entries.reduce((sum, e) => sum + Math.abs(e.amountCents), 0);
		expect(earned).toBe(sale.chargeCents);
	});

	it('pools the acts on the show, the way the online sale does', async () => {
		await recordDoorTicketSale(sale);
		const [[entries]] = recordEntries.mock.calls as unknown as [[Record<string, unknown>[]]];
		expect(entries.find((e) => e.category === 'act_payout')).toMatchObject({
			kind: 'pass_through',
			settlementGroup: 'evt-1'
		});
	});

	it('writes no zero rows', async () => {
		await recordDoorTicketSale({ ...sale, actsCents: 0, collectiveCents: 2914 });
		const [[entries]] = recordEntries.mock.calls as unknown as [[{ category: string }[]]];
		expect(entries.map((e) => e.category)).toEqual(['ticket_sales', 'card_fees']);
	});
});
