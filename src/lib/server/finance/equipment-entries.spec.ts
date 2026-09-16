import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EquipmentReturnedEvent } from '$lib/server/event-bus/event-bus';

/**
 * What a returned loan earns, and on which settlement axis.
 *
 * Splitting credit from cash is the whole point: `stripeSettledCents` joins on
 * `settlement`, so a credit-settled loan summed as cash would inflate what the
 * record claims cleared.
 */

const recordEntries = vi.fn<(inputs: Record<string, unknown>[]) => Promise<void>>(
	async () => undefined
);
let existing: unknown[] = [];
vi.mock('./financial-entry-service', () => ({
	recordEntries: (...a: unknown[]) => recordEntries(...(a as [Record<string, unknown>[]])),
	listForSubject: async () => existing
}));

const { recordEquipmentLoanCharge } = await import('./equipment-entries');

const returned = (over: Partial<EquipmentReturnedEvent> = {}): EquipmentReturnedEvent =>
	({
		loanId: 'loan-1',
		userId: 'user-1',
		userName: 'Sam Reyes',
		userEmail: 'sam@example.com',
		equipmentName: 'Fender Twin',
		totalChargeCents: 3000,
		creditsCents: 1000,
		cashCents: 2000,
		daysBorrowed: 3,
		...over
	}) as EquipmentReturnedEvent;

const written = () => recordEntries.mock.calls[0]?.[0] ?? [];

beforeEach(() => {
	vi.clearAllMocks();
	existing = [];
});

describe('a returned loan', () => {
	it('keeps the credit half off the settlement axis the Stripe check joins on', async () => {
		await recordEquipmentLoanCharge(returned());

		expect(written().find((e) => e.settlement === 'credit')).toMatchObject({
			amountCents: 1000,
			kind: 'earned',
			category: 'equipment',
			subjectType: 'inventory_loan',
			subjectId: 'loan-1'
		});
	});

	it('records the cash half separately', async () => {
		await recordEquipmentLoanCharge(returned());

		expect(written().find((e) => e.settlement === 'cash')).toMatchObject({
			amountCents: 2000,
			kind: 'earned',
			category: 'equipment'
		});
	});

	it('earns the whole charge across the two', async () => {
		await recordEquipmentLoanCharge(returned());
		expect(written().reduce((t, e) => t + (e.amountCents as number), 0)).toBe(3000);
	});

	it('writes one entry when the member had enough credits', async () => {
		await recordEquipmentLoanCharge(returned({ creditsCents: 3000, cashCents: 0 }));

		expect(written()).toHaveLength(1);
		expect(written()[0]).toMatchObject({ settlement: 'credit', amountCents: 3000 });
	});

	it('writes one entry when the member had none', async () => {
		await recordEquipmentLoanCharge(returned({ creditsCents: 0, cashCents: 3000 }));

		expect(written()).toHaveLength(1);
		expect(written()[0]).toMatchObject({ settlement: 'cash', amountCents: 3000 });
	});
});

describe('what it refuses to write', () => {
	it('writes nothing for a free loan', async () => {
		// Most loans are: `dailyRateCents` is nullable and usually unset.
		await recordEquipmentLoanCharge(
			returned({ totalChargeCents: 0, creditsCents: 0, cashCents: 0 })
		);
		expect(recordEntries).not.toHaveBeenCalled();
	});

	it('writes nothing twice for one loan', async () => {
		existing = [{ id: 'entry-1' }];
		await recordEquipmentLoanCharge(returned());
		expect(recordEntries).not.toHaveBeenCalled();
	});
});
