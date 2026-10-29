import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockUser } from '$lib/server/db/test-factory';

// #2067: a wizard booking that the member's usable free hours fully cover is
// settled when it is made, even outside the confirmation window. Partial
// cover, or a session on or after the reset, is still the scheduled hold.

const testUser = mockUser({ id: 'user-1', name: 'Test Member', email: 'member@example.com' });

const DAY = 24 * 60 * 60 * 1000;
const farOutDate = new Date(Date.now() + 30 * DAY).toISOString().slice(0, 10);
/** The session's start, as the mocked `buildDateInTz` builds it. */
const farOut = new Date(`${farOutDate}T09:00:00`);

// Payloads passed to `db.update(...).set(...)`, in call order.
const updateSets: Record<string, unknown>[] = [];
vi.mock('$lib/server/db', () => ({
	db: {
		select: () => {
			const c: Record<string, unknown> = {
				from: () => c,
				where: () => c,
				limit: () => Promise.resolve([])
			};
			return c;
		},
		update: () => ({
			set: (values: Record<string, unknown>) => {
				updateSets.push(values);
				return { where: () => Promise.resolve() };
			}
		})
	}
}));

const can = vi.fn(async (_cap: string) => false);
vi.mock('$lib/server/authorization', () => ({
	can: (...a: unknown[]) => can(...(a as [string])),
	requireCapability: vi.fn(async () => testUser),
	requireCapabilityOrOwner: vi.fn(),
	requireUser: () => testUser
}));

vi.mock('$lib/server/reservation/config', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/reservation/config')>()),
	getReservationConfig: vi.fn(async () => ({ hourlyRateCents: 1500 }))
}));

vi.mock('$lib/server/reservation/timezone', () => ({
	formatDateInTz: vi.fn(() => ''),
	buildDateInTz: vi.fn((date: string, time: string) => new Date(`${date}T${time}:00`))
}));

// The wallet (in 30-minute credits) is the input under test; the pure helpers
// that read it stay real, and the commit prices with the same math.
const wallet = { balance: 0, resetAt: null as Date | null };
const commitReservationCredits = vi.fn();
vi.mock('$lib/server/reservation/reservation-credit-service', async (importOriginal) => {
	const actual =
		await importOriginal<typeof import('$lib/server/reservation/reservation-credit-service')>();
	commitReservationCredits.mockImplementation(
		async (p: { totalCents: number; durationHours: number; hourlyRateCents: number }) => ({
			...actual.computeReservationCredit({ ...p, freeHoursBalance: wallet.balance }),
			alreadyCommitted: false
		})
	);
	return {
		...actual,
		getFreeHoursWallet: vi.fn(async () => wallet),
		commitReservationCredits,
		reverseReservationCredits: vi.fn()
	};
});

const recordReservationCredit = vi.fn(async () => undefined);
vi.mock('$lib/server/finance/reservation-entries', () => ({
	recordReservationCredit,
	recordReservationCash: vi.fn(),
	recordReservationCardPresent: vi.fn()
}));

// Stripe is never reached for real: these stand in for every client call.
const checkout = vi.fn();
vi.mock('$lib/server/finance/payment-service', () => ({
	checkout,
	recordCashPayment: vi.fn(async () => ({ paymentRecordId: 'rec-0' })),
	refund: vi.fn()
}));
vi.mock('$lib/server/finance/stripe-customer-service', () => ({
	ensureStripeCustomer: vi.fn(async () => 'cus_test')
}));

const announceConfirmed = vi.fn(async () => undefined);
vi.mock('$lib/server/reservation/reservation-service', () => ({
	create: vi.fn(async () => ({
		id: 'res-1',
		status: 'scheduled',
		startsAt: farOut,
		endsAt: farOut
	})),
	createWaitlisted: vi.fn(),
	announceConfirmed,
	confirm: vi.fn(),
	cancel: vi.fn(),
	markComplete: vi.fn(),
	markNoShow: vi.fn(),
	recordCashAndComplete: vi.fn(),
	staffCreate: vi.fn(),
	ReservationConflictError: class extends Error {},
	ReservationValidationError: class extends Error {}
}));

vi.mock('$lib/server/user/user-service', () => ({ ensureContactPhone: vi.fn(async () => true) }));
vi.mock('$lib/server/feature-flags', () => ({ requireFeature: vi.fn(async () => undefined) }));

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		locals: { user: testUser },
		url: new URL('http://localhost/member/reservations'),
		request: { headers: new Headers() }
	}),
	command: (_schema: unknown, handler: (...args: any[]) => any) => {
		(handler as any).__ = { type: 'command' };
		return handler;
	},
	form: (_schema: unknown, handler: (...args: any[]) => any) => {
		const fn = (data: unknown) => handler(data, {});
		(fn as any).__ = { type: 'form' };
		(fn as any).for = () => fn;
		return fn;
	},
	query: (...args: unknown[]) => {
		const fn = (typeof args[0] === 'function' ? args[0] : args[1]) as any;
		fn.__ = { type: 'query' };
		return fn;
	}
}));

const { bookAndPayReservation } = (await import('$lib/remote/reservations.remote')) as any;

/** A one-hour wizard booking 30 days out, submitted with the primary button. */
function book() {
	return bookAndPayReservation({
		date: farOutDate,
		startTime: '09:00',
		endTime: '10:00',
		skipPayment: 'on'
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	updateSets.length = 0;
	can.mockResolvedValue(false);
});

describe('bookAndPayReservation settles a fully covered booking from free hours', () => {
	it('confirms and commits credits when free hours cover it before the reset', async () => {
		wallet.balance = 8;
		wallet.resetAt = new Date(farOut.getTime() + 7 * DAY);

		const result = await book();

		expect(result).toMatchObject({ reservationId: 'res-1', confirmed: true });
		expect(result.scheduled).toBeUndefined();
		expect(commitReservationCredits).toHaveBeenCalledWith(
			expect.objectContaining({ reservationId: 'res-1', userId: 'user-1' })
		);
		expect(recordReservationCredit).toHaveBeenCalled();
		expect(updateSets).toContainEqual(
			expect.objectContaining({ status: 'confirmed', cashDueCents: 0, creditsUsed: 1 })
		);
		expect(announceConfirmed).toHaveBeenCalledWith('res-1');
		expect(checkout).not.toHaveBeenCalled();
	});

	it('leaves a partly covered booking as a scheduled hold', async () => {
		wallet.balance = 1;
		wallet.resetAt = new Date(farOut.getTime() + 7 * DAY);

		const result = await book();

		expect(result).toMatchObject({ reservationId: 'res-1', scheduled: true });
		expect(commitReservationCredits).not.toHaveBeenCalled();
		expect(updateSets).toEqual([]);
	});

	it('leaves a booking on or after the reset as a scheduled hold', async () => {
		wallet.balance = 8;
		wallet.resetAt = farOut;

		const result = await book();

		expect(result).toMatchObject({ reservationId: 'res-1', scheduled: true });
		expect(commitReservationCredits).not.toHaveBeenCalled();
		expect(updateSets).toEqual([]);
	});
});
