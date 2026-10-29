import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockUser } from '$lib/server/db/test-factory';
import { reservation } from '$lib/server/db/schema/reservation';
import { user } from '$lib/server/db/schema/authentication';

// #2060: free hours settle a fully covered booking at any time when its session
// starts before the member's next reset, and pay for nothing at or after it.
// The credit service runs for real; only the db, the ledger and Stripe are fake.

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const testUser = mockUser({ id: 'user-1', name: 'Test Member', email: 'member@example.com' });

let booking: Record<string, unknown> = {};
let subscription: Record<string, unknown> | null = null;

// Answers each select by the table it reads, so the order of reads is free to change.
function chain(): Record<string, unknown> {
	let table: unknown;
	const c: Record<string, unknown> = {
		from: (t: unknown) => ((table = t), c),
		where: () => c,
		limit: () => c,
		then: (resolve: (v: unknown[]) => void) =>
			resolve(
				table === reservation ? [booking] : table === user ? [{ subscription }] : [{ units: 0 }]
			)
	};
	return c;
}
const updates: Record<string, unknown>[] = [];
vi.mock('$lib/server/db', () => ({
	db: {
		select: () => chain(),
		update: () => ({
			set: (p: Record<string, unknown>) => (updates.push(p), { where: async () => undefined })
		})
	}
}));

vi.mock('$lib/server/authorization', () => ({
	can: vi.fn(async () => false),
	requireUser: () => testUser,
	requireCapability: vi.fn(),
	requireCapabilityOrOwner: vi.fn(),
	topPositionFor: vi.fn()
}));
vi.mock('$lib/server/reservation/config', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/reservation/config')>()),
	getReservationConfig: vi.fn(async () => ({ hourlyRateCents: 1500 }))
}));
// Ample: every booking below is fully covered wherever free hours apply at all.
const deductCredits = vi.fn();
vi.mock('$lib/server/finance/credit-service', () => ({
	getBalance: vi.fn(async () => 100),
	deductCredits: (...a: unknown[]) => deductCredits(...a)
}));
vi.mock('$lib/server/finance/reservation-entries', () => ({
	recordReservationCash: vi.fn(),
	recordReservationCredit: vi.fn()
}));
const checkout = vi.fn(async (..._a: unknown[]) => ({ checkoutUrl: 'https://pay.test/x' }));
vi.mock('$lib/server/finance/payment-service', () => ({
	checkout: (...a: unknown[]) => checkout(...a),
	recordCashPayment: vi.fn(async () => ({ paymentRecordId: 'pr-0' })),
	refund: vi.fn()
}));
vi.mock('$lib/server/finance/stripe-customer-service', () => ({
	ensureStripeCustomer: vi.fn(async () => 'cus_test')
}));
const confirm = vi.fn();
vi.mock('$lib/server/reservation/reservation-service', () => ({
	confirm: (...a: unknown[]) => confirm(...a),
	announceConfirmed: vi.fn(),
	ReservationConflictError: class extends Error {},
	ReservationValidationError: class extends Error {}
}));

// Kit refuses a remote module whose exports are not tagged as remote functions.
function tagged(handler: any, type: string) {
	handler.__ = { type };
	handler.for = () => handler;
	return handler;
}
vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		locals: { user: testUser },
		params: { id: 'res-1' },
		url: new URL('http://localhost/member/reservations'),
		request: { headers: new Headers() }
	}),
	form: (_schema: unknown, handler: (...args: any[]) => any) => tagged(handler, 'form'),
	query: (...args: any[]) => tagged(typeof args[0] === 'function' ? args[0] : args[1], 'query'),
	command: (...args: any[]) => tagged(typeof args[0] === 'function' ? args[0] : args[1], 'command')
}));

const { payForReservation, payReservation } =
	(await import('$lib/remote/reservations.remote')) as any;

/** A one-hour booking ten days out: well before its confirmation window opens. */
function bookTenDaysOut(resetOffsetMs: number) {
	const startsAt = new Date(Date.now() + 10 * DAY);
	booking = {
		id: 'res-1',
		createdByUserId: testUser.id,
		status: 'scheduled',
		bookerType: 'user',
		cashDueCents: null,
		startsAt,
		endsAt: new Date(startsAt.getTime() + 60 * MINUTE)
	};
	subscription = {
		hoursPerReset: 8,
		creditsResetAt: new Date(startsAt.getTime() + resetOffsetMs).toISOString()
	};
}

const settled = () => updates.find((u) => u.status === 'confirmed' && u.cashDueCents === 0);

beforeEach(() => {
	vi.clearAllMocks();
	updates.length = 0;
});

describe('payForReservation with credits, outside the confirmation window', () => {
	const run = () => payForReservation({ id: 'res-1', coverFees: false, skipPayment: 'on' });

	it('settles a session that starts one minute before the reset', async () => {
		bookTenDaysOut(MINUTE);
		await expect(run()).resolves.toEqual({ confirmed: true });
		expect(deductCredits).toHaveBeenCalledOnce();
		expect(settled()).toBeTruthy();
	});

	it('refuses a session that starts exactly at the reset, committing nothing', async () => {
		bookTenDaysOut(0);
		await expect(run()).rejects.toMatchObject({ status: 400 });
		expect(deductCredits).not.toHaveBeenCalled();
		expect(updates).toEqual([]);
	});

	it('refuses a member with no subscription', async () => {
		bookTenDaysOut(MINUTE);
		subscription = null;
		await expect(run()).rejects.toMatchObject({ status: 400 });
		expect(deductCredits).not.toHaveBeenCalled();
	});
});

describe('payReservation (the pay page), outside the confirmation window', () => {
	const run = () => payReservation({ coverFees: false });

	it('settles from free hours a session one minute before the reset, charging nothing', async () => {
		bookTenDaysOut(MINUTE);
		await expect(run()).rejects.toMatchObject({ status: 303, location: '/member/reservations' });
		expect(checkout).not.toHaveBeenCalled();
		expect(settled()).toBeTruthy();
	});

	it('charges the full price for a session at the reset, applying no free hours', async () => {
		bookTenDaysOut(0);
		await expect(run()).rejects.toMatchObject({ status: 303, location: 'https://pay.test/x' });
		expect(deductCredits).not.toHaveBeenCalled();
		const [opts] = checkout.mock.calls[0] as [
			{ lineItems: { price_data: { unit_amount: number } }[] }
		];
		expect(opts.lineItems[0].price_data.unit_amount).toBe(1500);
	});
});
