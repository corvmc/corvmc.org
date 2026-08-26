import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let selectResultQueue: unknown[][] = [];

function chainable() {
	const proxy: any = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				return (resolve: (v: unknown[]) => void) => {
					if (selectResultQueue.length > 0) return resolve(selectResultQueue.shift()!);
					return resolve([]);
				};
			}
			return () => proxy;
		}
	});
	return proxy;
}

let insertResult: unknown[] = [];
let updateResult: unknown[] = [];

vi.mock('$lib/server/db', () => ({
	db: {
		select: vi.fn(() => chainable()),
		insert: vi.fn(() => ({
			values: vi.fn(() => ({
				returning: vi.fn(() => Promise.resolve(insertResult))
			}))
		})),
		update: vi.fn(() => ({
			set: vi.fn(() => ({
				where: vi.fn(() => ({
					returning: vi.fn(() => Promise.resolve(updateResult))
				}))
			}))
		}))
	}
}));

vi.mock('$lib/server/event-bus/event-bus', () => ({
	domainEvents: {
		emit: vi.fn().mockResolvedValue(undefined)
	}
}));

vi.mock('$lib/server/finance/credit-service', () => ({
	getBalance: vi.fn().mockResolvedValue(0),
	deductCredits: vi.fn().mockResolvedValue(undefined),
	InsufficientCreditsError: class extends Error {
		constructor() {
			super('Insufficient credits');
			this.name = 'InsufficientCreditsError';
		}
	}
}));

vi.mock('$lib/server/finance/payment-service', () => ({
	recordCashPayment: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('$lib/server/finance/subscription-service', () => ({
	getSubscription: vi.fn().mockResolvedValue(null),
	isSustainingMember: vi.fn().mockResolvedValue(false)
}));

vi.mock('./equipment-service', () => ({
	getAvailableQuantity: vi.fn().mockResolvedValue(5)
}));

import {
	calculateDailyRate,
	calculateLoanCharge,
	requestLoan,
	scheduleLoan,
	checkoutLoan,
	returnLoan,
	cancelLoan,
	LoanNotFoundError,
	InvalidLoanTransitionError,
	InsufficientQuantityError
} from './loan-service';
import { getAvailableQuantity } from './equipment-service';
import {
	getBalance,
	deductCredits,
	InsufficientCreditsError
} from '$lib/server/finance/credit-service';
import { recordCashPayment } from '$lib/server/finance/payment-service';

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

describe('calculateDailyRate', () => {
	it('returns 500 for major items', () => {
		expect(calculateDailyRate('major', false)).toBe(500);
	});

	it('returns 500 for major items even for sustaining members', () => {
		expect(calculateDailyRate('major', true)).toBe(500);
	});

	it('returns 100 for accessories', () => {
		expect(calculateDailyRate('accessory', false)).toBe(100);
	});

	it('returns 0 for accessories when sustaining member', () => {
		expect(calculateDailyRate('accessory', true)).toBe(0);
	});
});

describe('calculateLoanCharge', () => {
	it('charges minimum 1 day', () => {
		const checkout = new Date('2025-07-01T10:00:00Z');
		const returnDate = new Date('2025-07-01T12:00:00Z');
		expect(calculateLoanCharge(500, checkout, returnDate)).toBe(500);
	});

	it('charges for full days rounded up', () => {
		const checkout = new Date('2025-07-01T10:00:00Z');
		const returnDate = new Date('2025-07-04T08:00:00Z');
		// ~2.9 days → ceil → 3
		expect(calculateLoanCharge(500, checkout, returnDate)).toBe(1500);
	});

	it('charges exact day boundaries', () => {
		const checkout = new Date('2025-07-01T00:00:00Z');
		const returnDate = new Date('2025-07-08T00:00:00Z');
		// exactly 7 days
		expect(calculateLoanCharge(100, checkout, returnDate)).toBe(700);
	});

	it('returns 0 when rate is 0', () => {
		const checkout = new Date('2025-07-01T00:00:00Z');
		const returnDate = new Date('2025-07-05T00:00:00Z');
		expect(calculateLoanCharge(0, checkout, returnDate)).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

describe('LoanService lifecycle', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		selectResultQueue = [];
		insertResult = [];
		updateResult = [];

		vi.mocked(getAvailableQuantity).mockResolvedValue(5);
		vi.mocked(getBalance).mockResolvedValue(0);
	});

	describe('requestLoan', () => {
		it('creates a loan and returns it', async () => {
			const loan = { id: 'loan-1', status: 'requested', userId: 'user-1' };
			insertResult = [loan];
			selectResultQueue = [[{ name: 'Test User', email: 'test@example.com' }], [{ name: 'SM58' }]];

			const result = await requestLoan('user-1', {
				equipmentId: 'eq-1',
				requestedPickupDate: new Date('2025-07-15'),
				estimatedReturnDate: new Date('2025-07-20')
			});
			expect(result).toEqual(loan);
		});

		it('checks availability when equipmentId is provided', async () => {
			vi.mocked(getAvailableQuantity).mockResolvedValue(0);

			await expect(
				requestLoan('user-1', {
					equipmentId: 'eq-1',
					quantity: 2,
					requestedPickupDate: new Date('2025-07-15'),
					estimatedReturnDate: new Date('2025-07-20')
				})
			).rejects.toThrow(InsufficientQuantityError);
		});

		it('allows free-form requests without equipmentId', async () => {
			const loan = { id: 'loan-1', status: 'requested', equipmentId: null };
			insertResult = [loan];
			selectResultQueue = [[{ name: 'Test User', email: 'test@example.com' }]];

			const result = await requestLoan('user-1', {
				requestedPickupDate: new Date('2025-07-15'),
				estimatedReturnDate: new Date('2025-07-20'),
				memberNotes: 'Need a bass amp 300W+'
			});
			expect(result.equipmentId).toBeNull();
		});
	});

	describe('scheduleLoan', () => {
		it('transitions requested → scheduled', async () => {
			selectResultQueue = [[{ id: 'loan-1', status: 'requested', quantity: 1, userId: 'user-1' }]];
			const updated = { id: 'loan-1', status: 'scheduled' };
			updateResult = [updated];
			selectResultQueue.push(
				[{ name: 'Test User', email: 'test@example.com' }],
				[{ name: 'SM58' }]
			);

			const result = await scheduleLoan('loan-1', {
				equipmentId: 'eq-1',
				scheduledPickupDate: new Date('2025-07-15')
			});
			expect(result.status).toBe('scheduled');
		});

		it('rejects transition from checked_out', async () => {
			selectResultQueue = [
				[{ id: 'loan-1', status: 'checked_out', quantity: 1, userId: 'user-1' }]
			];

			await expect(
				scheduleLoan('loan-1', {
					equipmentId: 'eq-1',
					scheduledPickupDate: new Date('2025-07-15')
				})
			).rejects.toThrow(InvalidLoanTransitionError);
		});

		it('throws LoanNotFoundError for missing loan', async () => {
			selectResultQueue = [[]];

			await expect(
				scheduleLoan('bad-id', {
					equipmentId: 'eq-1',
					scheduledPickupDate: new Date()
				})
			).rejects.toThrow(LoanNotFoundError);
		});
	});

	describe('checkoutLoan', () => {
		it('transitions scheduled → checked_out', async () => {
			selectResultQueue = [
				[{ id: 'loan-1', status: 'scheduled', equipmentId: 'eq-1', userId: 'user-1' }],
				[{ name: 'SM58', pricingTier: 'major' }],
				[{ stripeId: null }]
			];
			const updated = { id: 'loan-1', status: 'checked_out', dailyRateCents: 500 };
			updateResult = [updated];

			const result = await checkoutLoan('loan-1', { dueDate: new Date('2025-07-22') });
			expect(result.status).toBe('checked_out');
			expect(result.dailyRateCents).toBe(500);
		});

		it('rejects transition from requested', async () => {
			selectResultQueue = [
				[{ id: 'loan-1', status: 'requested', equipmentId: 'eq-1', userId: 'user-1' }]
			];

			await expect(checkoutLoan('loan-1', { dueDate: new Date() })).rejects.toThrow(
				InvalidLoanTransitionError
			);
		});
	});

	describe('returnLoan', () => {
		it('transitions checked_out → returned and calculates charge', async () => {
			const checkedOutAt = new Date('2025-07-01T10:00:00Z');
			selectResultQueue = [
				[
					{
						id: 'loan-1',
						status: 'checked_out',
						equipmentId: 'eq-1',
						userId: 'user-1',
						dailyRateCents: 500,
						checkedOutAt,
						staffNotes: null
					}
				],
				[{ name: 'Test User', stripeId: 'cus_test' }]
			];
			const updated = {
				id: 'loan-1',
				status: 'returned',
				totalChargeCents: 500,
				creditsCents: 0,
				cashCents: 500
			};
			updateResult = [updated];
			selectResultQueue.push([{ name: 'SM58' }]);

			const result = await returnLoan('loan-1');
			expect(result.status).toBe('returned');
		});

		it('rejects transition from requested', async () => {
			selectResultQueue = [[{ id: 'loan-1', status: 'requested', userId: 'user-1' }]];

			await expect(returnLoan('loan-1')).rejects.toThrow(InvalidLoanTransitionError);
		});

		it('retries with the fresh balance when a concurrent spend races the deduction', async () => {
			// 12h ago → exactly one chargeable day at 500¢/day.
			const checkedOutAt = new Date(Date.now() - 12 * 60 * 60 * 1000);
			selectResultQueue = [
				[
					{
						id: 'loan-1',
						status: 'checked_out',
						equipmentId: 'eq-1',
						userId: 'user-1',
						dailyRateCents: 500,
						checkedOutAt,
						staffNotes: null
					}
				],
				[{ name: 'Test User', stripeId: 'cus_test' }]
			];
			updateResult = [{ id: 'loan-1', status: 'returned' }];
			selectResultQueue.push([{ name: 'SM58' }]);

			// First read sees 300¢ of credits but a concurrent spend wins the
			// deduction; the retry re-reads 200¢ and settles 200 credits + 300 cash
			// instead of abandoning the member's remaining credits for full cash.
			vi.mocked(getBalance).mockResolvedValueOnce(300).mockResolvedValueOnce(200);
			vi.mocked(deductCredits)
				.mockRejectedValueOnce(new InsufficientCreditsError('equipment_credits', 300, 200))
				.mockResolvedValueOnce(0);

			await returnLoan('loan-1');

			expect(vi.mocked(deductCredits)).toHaveBeenCalledTimes(2);
			expect(vi.mocked(deductCredits).mock.calls[0][2]).toBe(300);
			expect(vi.mocked(deductCredits).mock.calls[1][2]).toBe(200);
			expect(vi.mocked(recordCashPayment)).toHaveBeenCalledWith(
				expect.objectContaining({ amountCents: 300 })
			);
		});
	});

	describe('cancelLoan', () => {
		it('cancels a requested loan', async () => {
			selectResultQueue = [[{ id: 'loan-1', status: 'requested' }]];
			updateResult = [{ id: 'loan-1', status: 'cancelled' }];

			const result = await cancelLoan('loan-1');
			expect(result.status).toBe('cancelled');
		});

		it('cancels a scheduled loan', async () => {
			selectResultQueue = [[{ id: 'loan-1', status: 'scheduled' }]];
			updateResult = [{ id: 'loan-1', status: 'cancelled' }];

			const result = await cancelLoan('loan-1');
			expect(result.status).toBe('cancelled');
		});

		it('rejects cancellation of checked_out loan', async () => {
			selectResultQueue = [[{ id: 'loan-1', status: 'checked_out' }]];

			await expect(cancelLoan('loan-1')).rejects.toThrow(InvalidLoanTransitionError);
		});

		it('rejects cancellation of returned loan', async () => {
			selectResultQueue = [[{ id: 'loan-1', status: 'returned' }]];

			await expect(cancelLoan('loan-1')).rejects.toThrow(InvalidLoanTransitionError);
		});
	});
});
