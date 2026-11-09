import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockUser } from '#lib/server/db/test-factory.js';

// #2502: a booking is confirmed when it is made, however far ahead, so the
// primary button spends free hours then and any remainder is cash at the door
// (#2108). Paying ahead charges the remainder online. Neither re-confirms it.

const testUser = mockUser({ id: 'user-1', name: 'Test Member', email: 'member@example.com' });

const DAY = 24 * 60 * 60 * 1000;
const farOutDate = new Date(Date.now() + 30 * DAY).toISOString().slice(0, 10);
/** The session's start, as the mocked `buildDateInTz` builds it. */
const farOut = new Date(`${farOutDate}T09:00:00`);
const soonDate = new Date(Date.now() + 1 * DAY).toISOString().slice(0, 10);
const soon = new Date(`${soonDate}T09:00:00`);

// Payloads passed to `db.update(...).set(...)`, in call order.
const updateSets: Record<string, unknown>[] = [];
vi.mock('#lib/server/db/index.js', () => ({
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
vi.mock('#lib/server/authorization.js', () => ({
	can: (...a: unknown[]) => can(...(a as [string])),
	requireCapability: vi.fn(async () => testUser),
	requireCapabilityOrOwner: vi.fn(),
	requireUser: () => testUser
}));

vi.mock('#lib/server/reservation/config.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('#lib/server/reservation/config.js')>()),
	getReservationConfig: vi.fn(async () => ({ hourlyRateCents: 1500 }))
}));

vi.mock('#lib/server/reservation/timezone.js', () => ({
	formatDateInTz: vi.fn(() => ''),
	buildDateInTz: vi.fn((date: string, time: string) => new Date(`${date}T${time}:00`))
}));

// The wallet (in 30-minute credits) is the input under test; the pure helpers
// that read it stay real, and the commit prices with the same math.
const wallet = { balance: 0, resetAt: null as Date | null };
const commitReservationCredits = vi.fn();
vi.mock('#lib/server/reservation/reservation-credit-service.js', async (importOriginal) => {
	const actual =
		await importOriginal<typeof import('#lib/server/reservation/reservation-credit-service.js')>();
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
vi.mock('#lib/server/finance/reservation-entries.js', () => ({
	recordReservationCredit,
	recordReservationCash: vi.fn(),
	recordReservationCardPresent: vi.fn()
}));

// Stripe is never reached for real: these stand in for every client call.
const checkout = vi.fn();
vi.mock('#lib/server/finance/payment-service.js', () => ({
	checkout,
	recordCashPayment: vi.fn(async () => ({ paymentRecordId: 'rec-0' })),
	refund: vi.fn()
}));
vi.mock('#lib/server/finance/stripe-customer-service.js', () => ({
	ensureStripeCustomer: vi.fn(async () => 'cus_test')
}));

vi.mock('#lib/server/reservation/reservation-service.js', () => ({
	create: vi.fn(async () => ({
		id: 'res-1',
		status: 'confirmed',
		startsAt: farOut,
		endsAt: farOut
	})),
	createWaitlisted: vi.fn(),
	confirm: vi.fn(),
	cancel: vi.fn(),
	markComplete: vi.fn(),
	markNoShow: vi.fn(),
	recordCashAndComplete: vi.fn(),
	staffCreate: vi.fn(),
	ReservationConflictError: class extends Error {},
	ReservationValidationError: class extends Error {}
}));

vi.mock('#lib/server/user/user-service.js', () => ({
	ensureContactPhone: vi.fn(async () => true)
}));
vi.mock('#lib/server/feature-flags.js', () => ({ requireFeature: vi.fn(async () => undefined) }));

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

const { bookAndPayReservation } = (await import('#lib/remote/reservations.remote.js')) as any;

/** A one-hour wizard booking; `skipPayment` is the primary button, else Pay Ahead. */
function book(date = farOutDate, primary = true) {
	return bookAndPayReservation({
		date,
		startTime: '09:00',
		endTime: '10:00',
		coverFees: false,
		...(primary ? { skipPayment: 'on' } : {})
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	updateSets.length = 0;
	can.mockResolvedValue(false);
});

describe('bookAndPayReservation prices the booking when it is made', () => {
	it.each([
		['a month out', farOutDate, farOut],
		['tomorrow', soonDate, soon]
	])('spends free hours on a covered booking %s', async (_label, date, start) => {
		wallet.balance = 8;
		wallet.resetAt = new Date(start.getTime() + 7 * DAY);

		const result = await book(date);

		expect(result).toMatchObject({ reservationId: 'res-1', confirmed: true });
		expect(commitReservationCredits).toHaveBeenCalledWith(
			expect.objectContaining({ reservationId: 'res-1', userId: 'user-1' })
		);
		expect(updateSets).toContainEqual(expect.objectContaining({ cashDueCents: 0, creditsUsed: 1 }));
		expect(checkout).not.toHaveBeenCalled();
	});

	it('leaves the remainder of a partly covered booking owed at the door', async () => {
		wallet.balance = 1;
		wallet.resetAt = new Date(farOut.getTime() + 7 * DAY);

		const result = await book();

		expect(result).toMatchObject({ reservationId: 'res-1', confirmed: true });
		expect(commitReservationCredits).toHaveBeenCalled();
		expect(checkout).not.toHaveBeenCalled();
	});

	it('settles a covered booking paid ahead as a $0 payment', async () => {
		wallet.balance = 8;
		wallet.resetAt = new Date(farOut.getTime() + 7 * DAY);

		const result = await book(farOutDate, false);

		expect(result).toMatchObject({ reservationId: 'res-1', paid: true });
		expect(updateSets).toContainEqual(expect.objectContaining({ cashDueCents: 0, creditsUsed: 1 }));
		expect(checkout).not.toHaveBeenCalled();
	});

	it('changes payment fields only, never the status', async () => {
		wallet.balance = 8;
		wallet.resetAt = new Date(farOut.getTime() + 7 * DAY);

		await book();
		await book(farOutDate, false);

		expect(updateSets.some((set) => 'status' in set)).toBe(false);
	});
});
