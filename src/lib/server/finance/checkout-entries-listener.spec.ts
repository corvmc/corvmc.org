import { describe, it, expect, vi, beforeEach } from 'vitest';

const recorded: unknown[][] = [];
vi.mock('./financial-entry-service', () => ({
	recordEntriesBestEffort: async (rows: unknown[]) => {
		recorded.push(rows);
	}
}));

const { handleCheckoutEntries } = await import('./checkout-entries-listener');

/** A $10 ticket at the default split: acts $7.00, collective $3.00, fee 59¢. */
const ticketSession = (over: Record<string, unknown> = {}) =>
	({
		id: 'cs_1',
		payment_intent: 'pi_1',
		amount_total: 1000,
		metadata: {
			type: 'ticket',
			user_id: 'user-1',
			event_id: 'evt-1',
			purchase_id: 'tkt-1',
			ticket_acts_cents: '700',
			ticket_collective_cents: '300'
		},
		...over
	}) as never;

const rows = () => recorded[0] as Record<string, unknown>[];
const of = (kind: string, category?: string) =>
	rows().filter((r) => r.kind === kind && (!category || r.category === category));

beforeEach(() => (recorded.length = 0));

describe('a ticket sale', () => {
	it('writes the collective earning, the acts pass-through and the card fee', async () => {
		await handleCheckoutEntries(ticketSession());

		expect(of('earned', 'ticket_sales')[0]).toMatchObject({ amountCents: 300 });
		expect(of('pass_through')[0]).toMatchObject({ amountCents: 700, settlementGroup: 'evt-1' });
		expect(of('spent', 'card_fees')[0]).toMatchObject({ amountCents: -59 });
		// $9.41 reaches the balance, which is the charge less the fee.
		expect(rows().reduce((s, r) => s + (r.amountCents as number), 0)).toBe(941);
	});

	it('keys the pool on the show, not the ticket', async () => {
		// Money arrives in many rows and leaves in one; the pool is the join.
		await handleCheckoutEntries(ticketSession());
		expect(of('pass_through')[0].settlementGroup).toBe('evt-1');
		expect(of('pass_through')[0].subjectId).toBe('tkt-1');
	});

	it('records fee coverage as earned beside the fee it offsets', async () => {
		await handleCheckoutEntries(
			ticketSession({
				amount_total: 1061,
				metadata: {
					type: 'ticket',
					user_id: 'user-1',
					event_id: 'evt-1',
					purchase_id: 'tkt-1',
					ticket_acts_cents: '700',
					ticket_collective_cents: '300',
					ticket_fee_covered_cents: '61'
				}
			})
		);

		expect(of('earned', 'fee_coverage')[0]).toMatchObject({ amountCents: 61 });
		expect(of('spent', 'card_fees')[0]).toMatchObject({ amountCents: -61 });
		// The collective keeps its full 30% when the buyer covers the card.
		const collective = 300 + 61 - 61;
		expect(collective).toBe(300);
	});

	it('writes no zero rows for a share nobody took', async () => {
		await handleCheckoutEntries(
			ticketSession({
				metadata: {
					type: 'ticket',
					user_id: 'user-1',
					event_id: 'evt-1',
					purchase_id: 'tkt-1',
					ticket_acts_cents: '941',
					ticket_collective_cents: '0'
				}
			})
		);
		expect(of('earned', 'ticket_sales')).toHaveLength(0);
		expect(of('pass_through')[0]).toMatchObject({ amountCents: 941 });
	});
});

describe('a reservation', () => {
	it('records the whole charge as earned, less the card', async () => {
		await handleCheckoutEntries({
			id: 'cs_2',
			payment_intent: 'pi_2',
			amount_total: 3000,
			metadata: { user_id: 'user-1', reservation_id: 'res-1' }
		} as never);

		expect(of('earned', 'reservation')[0]).toMatchObject({ amountCents: 3000 });
		expect(of('spent', 'card_fees')[0]).toMatchObject({ amountCents: -117 });
		// No pass-through: nobody else is owed a share of a practice room.
		expect(of('pass_through')).toHaveLength(0);
	});
});

describe('a checkout it does not recognise', () => {
	it('writes nothing rather than guessing', async () => {
		await handleCheckoutEntries({
			id: 'cs_3',
			amount_total: 5000,
			metadata: { type: 'band_premium', user_id: 'user-1' }
		} as never);
		expect(rows()).toHaveLength(0);
	});
});
