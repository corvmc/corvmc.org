import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks (used by the reverseReservationCredits tests; the pure
// computeReservationCredit tests below don't touch them)
// ---------------------------------------------------------------------------

// Each awaited db.select() chain consumes the next queued result.
let dbQueryResults: unknown[][] = [];
// Payloads passed to db.update(...).set(...) in call order.
const updateSetPayloads: Record<string, unknown>[] = [];

function chainable() {
	const proxy: any = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				const result = dbQueryResults.shift() ?? [];
				return (resolve: (v: unknown) => void) => resolve(result);
			}
			if (prop === 'set') {
				return (payload: Record<string, unknown>) => {
					updateSetPayloads.push(payload);
					return proxy;
				};
			}
			return () => proxy;
		}
	});
	return proxy;
}

vi.mock('$lib/server/db', () => ({
	db: {
		select: () => chainable(),
		update: () => chainable()
	}
}));

const mockCreditService = {
	hasTransaction: vi.fn(),
	getBalance: vi.fn(),
	addCredits: vi.fn(),
	deductCredits: vi.fn(),
	getAllBalances: vi.fn()
};
vi.mock('$lib/server/finance/credit-service', () => mockCreditService);

const {
	computeReservationCredit,
	commitReservationCredits,
	reverseReservationCredits,
	freeHoursApplyTo,
	freeHoursResetAt
} = await import('./reservation-credit-service');

// The next reset, and a subscription whose "Resets to N on <date>" shows it.
const RESET_AT = new Date('2026-11-15T08:00:00Z');
const MINUTE = 60_000;
const subscribed = { subscription: { hoursPerReset: 8, creditsResetAt: RESET_AT.toISOString() } };

// hourlyRateCents 1500 ($15/hr) → creditValueCents = 750 (30-min block),
// hoursToCredits(hours) = hours * 2.
const RATE = 1500;

describe('computeReservationCredit', () => {
	it('applies no credit when the balance is zero', () => {
		const r = computeReservationCredit({
			totalCents: 3000,
			durationHours: 2,
			hourlyRateCents: RATE,
			freeHoursBalance: 0
		});
		expect(r).toEqual({ creditUnits: 0, creditDiscountCents: 0, remainingCents: 3000 });
	});

	it('fully covers a session when the balance is ample', () => {
		const r = computeReservationCredit({
			totalCents: 3000,
			durationHours: 2,
			hourlyRateCents: RATE,
			freeHoursBalance: 12
		});
		// 2 hr → 4 credits needed, 4 × 750 = 3000 = total.
		expect(r).toEqual({ creditUnits: 4, creditDiscountCents: 3000, remainingCents: 0 });
	});

	it('partially covers, leaving a cash remainder', () => {
		const r = computeReservationCredit({
			totalCents: 3000,
			durationHours: 2,
			hourlyRateCents: RATE,
			freeHoursBalance: 2 // 2 credits = 1 hour
		});
		expect(r).toEqual({ creditUnits: 2, creditDiscountCents: 1500, remainingCents: 1500 });
	});

	it('never discounts more than the total when balance exceeds need', () => {
		const r = computeReservationCredit({
			totalCents: 1500,
			durationHours: 1,
			hourlyRateCents: RATE,
			freeHoursBalance: 50
		});
		// 1 hr → 2 credits needed; discount capped at total.
		expect(r.creditUnits).toBe(2);
		expect(r.creditDiscountCents).toBe(1500);
		expect(r.remainingCents).toBe(0);
	});

	it('handles half-hour sessions (1 credit)', () => {
		const r = computeReservationCredit({
			totalCents: 750,
			durationHours: 0.5,
			hourlyRateCents: RATE,
			freeHoursBalance: 5
		});
		expect(r).toEqual({ creditUnits: 1, creditDiscountCents: 750, remainingCents: 0 });
	});
});

// ---------------------------------------------------------------------------
// reverseReservationCredits — reversal is capped at the current allocation so
// confirm → monthly reset → cancel can't mint credits (see H3 in the revenue
// audit). Query order per call: committed-units sum, then user subscription.
// ---------------------------------------------------------------------------
describe('reverseReservationCredits', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		dbQueryResults = [];
		mockCreditService.hasTransaction.mockResolvedValue(false);
	});

	it('reverses the committed units when within the allocation', async () => {
		dbQueryResults = [
			[{ units: 4 }], // committed to the reservation
			[{ subscription: { hoursPerReset: 10 } }] // current allocation (credits)
		];
		mockCreditService.getBalance.mockResolvedValue(6); // 10 allocated − 4 spent

		await reverseReservationCredits('user-1', 'res-1');

		expect(mockCreditService.addCredits).toHaveBeenCalledWith(
			'user-1',
			'free_hours',
			4,
			'cancelled',
			'res-1',
			expect.any(String)
		);
	});

	it('adds nothing when the balance is already at the allocation (post-reset cancel)', async () => {
		dbQueryResults = [[{ units: 4 }], [{ subscription: { hoursPerReset: 10 } }]];
		// invoice.paid reset the wallet to the full allocation after the commit.
		mockCreditService.getBalance.mockResolvedValue(10);

		await reverseReservationCredits('user-1', 'res-1');

		expect(mockCreditService.addCredits).not.toHaveBeenCalled();
	});

	it('clamps a partial reversal to the allocation ceiling', async () => {
		dbQueryResults = [[{ units: 4 }], [{ subscription: { hoursPerReset: 10 } }]];
		mockCreditService.getBalance.mockResolvedValue(8); // room for only 2

		await reverseReservationCredits('user-1', 'res-1');

		expect(mockCreditService.addCredits).toHaveBeenCalledWith(
			'user-1',
			'free_hours',
			2,
			'cancelled',
			'res-1',
			expect.any(String)
		);
	});

	it('adds nothing for a member with no subscription', async () => {
		dbQueryResults = [[{ units: 4 }], [{ subscription: null }]];
		mockCreditService.getBalance.mockResolvedValue(0);

		await reverseReservationCredits('user-1', 'res-1');

		expect(mockCreditService.addCredits).not.toHaveBeenCalled();
	});

	it('is a no-op when the reversal was already recorded', async () => {
		mockCreditService.hasTransaction.mockResolvedValue(true);

		await reverseReservationCredits('user-1', 'res-1');

		expect(mockCreditService.addCredits).not.toHaveBeenCalled();
	});

	it('is a no-op when nothing was committed', async () => {
		dbQueryResults = [[{ units: 0 }]];

		await reverseReservationCredits('user-1', 'res-1');

		expect(mockCreditService.addCredits).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// commitReservationCredits — partial coverage must record creditsUsed too.
// Query order: reservation row (cashDueCents null = uncommitted), then the
// mocked balance; the UPDATE payload is captured via updateSetPayloads.
// ---------------------------------------------------------------------------
describe('commitReservationCredits', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		dbQueryResults = [];
		updateSetPayloads.length = 0;
	});

	it('records creditsUsed (hours) on a partially covered commit', async () => {
		dbQueryResults = [[{ cashDueCents: null, startsAt: new Date(0) }], [subscribed]];
		mockCreditService.getBalance.mockResolvedValue(2); // 2 credits = 1 hour

		const result = await commitReservationCredits({
			userId: 'user-1',
			reservationId: 'res-1',
			totalCents: 3000,
			durationHours: 2,
			hourlyRateCents: RATE
		});

		expect(result).toMatchObject({
			creditUnits: 2,
			creditDiscountCents: 1500,
			remainingCents: 1500,
			alreadyCommitted: false
		});
		expect(updateSetPayloads[0]).toMatchObject({ cashDueCents: 1500, creditsUsed: 1 });
	});

	it('leaves creditsUsed null when no credits apply', async () => {
		dbQueryResults = [[{ cashDueCents: null, startsAt: new Date(0) }], [subscribed]];
		mockCreditService.getBalance.mockResolvedValue(0);

		await commitReservationCredits({
			userId: 'user-1',
			reservationId: 'res-1',
			totalCents: 3000,
			durationHours: 2,
			hourlyRateCents: RATE
		});

		expect(mockCreditService.deductCredits).not.toHaveBeenCalled();
		expect(updateSetPayloads[0]).toMatchObject({ cashDueCents: 3000, creditsUsed: null });
	});
});

// #2060: free hours pay only for a session that starts before the next reset,
// so they never carry into the next allocation period.
describe('free hours stop at the next reset', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		dbQueryResults = [];
		updateSetPayloads.length = 0;
		mockCreditService.getBalance.mockResolvedValue(100);
	});

	it('reads the reset from the subscription, and none without one', () => {
		expect(freeHoursResetAt(subscribed.subscription as never)).toEqual(RESET_AT);
		expect(freeHoursResetAt(null)).toBeNull();
	});

	it('applies to a session one minute before the reset, not one at it', () => {
		expect(freeHoursApplyTo(new Date(RESET_AT.getTime() - MINUTE), RESET_AT)).toBe(true);
		expect(freeHoursApplyTo(RESET_AT, RESET_AT)).toBe(false);
		expect(freeHoursApplyTo(new Date(RESET_AT.getTime() + MINUTE), RESET_AT)).toBe(false);
	});

	it('never applies without a reset date', () => {
		expect(freeHoursApplyTo(new Date(0), null)).toBe(false);
	});

	async function commitFor(startsAt: Date, userRow: unknown = subscribed) {
		dbQueryResults = [[{ cashDueCents: null, startsAt }], [userRow]];
		return commitReservationCredits({
			userId: 'user-1',
			reservationId: 'res-1',
			totalCents: 3000,
			durationHours: 2,
			hourlyRateCents: RATE
		});
	}

	it('commits credits for a session one minute before the reset', async () => {
		const r = await commitFor(new Date(RESET_AT.getTime() - MINUTE));
		expect(r.remainingCents).toBe(0);
		expect(mockCreditService.deductCredits).toHaveBeenCalledOnce();
	});

	it('commits none for a session exactly at the reset, leaving the full price owed', async () => {
		const r = await commitFor(RESET_AT);
		expect(r).toMatchObject({ creditUnits: 0, remainingCents: 3000 });
		expect(mockCreditService.deductCredits).not.toHaveBeenCalled();
		expect(updateSetPayloads[0]).toMatchObject({ cashDueCents: 3000, creditsUsed: null });
	});

	it('commits none for a member with no subscription, whatever the balance', async () => {
		const r = await commitFor(new Date(0), { subscription: null });
		expect(r.remainingCents).toBe(3000);
		expect(mockCreditService.deductCredits).not.toHaveBeenCalled();
	});
});
