import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockUser } from '$lib/server/db/test-factory';

/**
 * `payAtReader` is the guard and the arithmetic; the reader itself is
 * `reader-payment.spec.ts`. What matters here: only the owner, only inside the
 * window, credits before cash, and the amount never comes from the client.
 */

const member = mockUser({ id: 'member-1', name: 'Member', email: 'member@example.com' });
const HOUR = 3600_000;

const selectResults: unknown[][] = [];
function chain() {
	const c: Record<string, unknown> = {
		from: () => c,
		where: () => c,
		leftJoin: () => c,
		innerJoin: () => c,
		limit: () => Promise.resolve(selectResults.shift() ?? [])
	};
	return c;
}

vi.mock('$lib/server/db', () => ({
	db: {
		select: () => chain(),
		update: () => ({ set: () => ({ where: () => Promise.resolve() }) })
	}
}));

vi.mock('$lib/server/authorization', () => ({
	requireUser: () => member,
	requireCapability: vi.fn(async () => undefined),
	can: vi.fn(async () => false),
	requireCapabilityOrOwner: vi.fn(),
	topPositionFor: vi.fn()
}));

vi.mock('$lib/server/reservation/config', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/reservation/config')>()),
	getReservationConfig: vi.fn(async () => ({ hourlyRateCents: 1500 })),
	getBookingTerms: vi.fn(async () => ({ hourlyRateCents: 1500 }))
}));

vi.mock('$lib/server/finance/credit-service', () => ({ getBalance: vi.fn(async () => 0) }));

const commitReservationCredits = vi.fn();
vi.mock('$lib/server/reservation/reservation-credit-service', async (importOriginal) => {
	const actual =
		await importOriginal<typeof import('$lib/server/reservation/reservation-credit-service')>();
	return {
		computeReservationCredit: actual.computeReservationCredit,
		commitReservationCredits: (...a: unknown[]) => commitReservationCredits(...a),
		reverseReservationCredits: vi.fn()
	};
});

vi.mock('$lib/server/finance/reservation-entries', () => ({
	recordReservationCredit: vi.fn(),
	recordReservationCash: vi.fn()
}));
vi.mock('$lib/server/finance/stripe-customer-service', () => ({
	ensureStripeCustomer: vi.fn(async () => 'cus_1')
}));
vi.mock('$lib/server/finance/payment-service', () => ({
	checkout: vi.fn(),
	recordCashPayment: vi.fn(async () => ({ paymentRecordId: 'pr_0' })),
	refund: vi.fn()
}));

vi.mock('$lib/server/reservation/reservation-service', () => ({
	create: vi.fn(),
	createWaitlisted: vi.fn(),
	confirm: vi.fn(),
	cancel: vi.fn(),
	markComplete: vi.fn(),
	markNoShow: vi.fn(),
	recordCashAndComplete: vi.fn(),
	staffCreate: vi.fn(),
	announceConfirmed: vi.fn(),
	ReservationConflictError: class extends Error {}
}));

const startReaderPayment = vi.fn(async () => ({ paymentIntentId: 'pi_reader' }));
const cancelReaderPayment = vi.fn(async () => undefined);
const simulateReaderTap = vi.fn(async () => undefined);
vi.mock('$lib/server/reservation/reader-payment', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/reservation/reader-payment')>()),
	startReaderPayment: (...a: unknown[]) => startReaderPayment(...(a as [])),
	cancelReaderPayment: (...a: unknown[]) => cancelReaderPayment(...(a as [])),
	simulateReaderTap: (...a: unknown[]) => simulateReaderTap(...(a as []))
}));

const terminalReaderId = vi.fn<() => string | null>(() => 'tmr_fake');
const readerTapCanBeSimulated = vi.fn(() => true);
vi.mock('$lib/server/finance/terminal-service', () => ({
	terminalReaderId: () => terminalReaderId(),
	readerTapCanBeSimulated: () => readerTapCanBeSimulated()
}));

vi.mock('$lib/server/feature-flags', () => ({ requireFeature: vi.fn(async () => undefined) }));

vi.mock('$app/server', () => {
	// The raw handler, marked the way kit's export check looks for.
	const remote =
		(type: string) =>
		(...args: any[]) => {
			const fn = args[args.length - 1] as (...a: any[]) => any;
			(fn as any).__ = { type };
			(fn as any).for = () => fn;
			return fn;
		};
	return {
		getRequestEvent: () => ({
			locals: { user: member },
			url: new URL('http://localhost/member/reservations'),
			request: { headers: new Headers() }
		}),
		form: remote('form'),
		command: remote('command'),
		query: remote('query')
	};
});

const { payAtReader, cancelPayAtReader, simulatePayAtReader } =
	(await import('$lib/remote/reservations.remote')) as any;

function booking(over: Record<string, unknown> = {}) {
	return {
		id: 'res-1',
		createdByUserId: member.id,
		bookerType: 'user',
		status: 'scheduled',
		paidAt: null,
		cashDueCents: null,
		startsAt: new Date(Date.now() + HOUR),
		endsAt: new Date(Date.now() + 3 * HOUR),
		...over
	};
}

beforeEach(() => {
	selectResults.length = 0;
	vi.clearAllMocks();
	terminalReaderId.mockReturnValue('tmr_fake');
	readerTapCanBeSimulated.mockReturnValue(true);
	commitReservationCredits.mockImplementation(async (p: { totalCents: number }) => ({
		creditUnits: 0,
		creditDiscountCents: 0,
		remainingCents: p.totalCents,
		alreadyCommitted: false
	}));
});

describe('payAtReader', () => {
	it("refuses someone else's booking before anything is charged", async () => {
		selectResults.push([booking({ createdByUserId: 'someone-else' })]);
		await expect(payAtReader('res-1')).rejects.toMatchObject({ status: 403 });
		expect(commitReservationCredits).not.toHaveBeenCalled();
		expect(startReaderPayment).not.toHaveBeenCalled();
	});

	it('refuses a booking that is not today, or already paid', async () => {
		selectResults.push([booking({ startsAt: new Date(Date.now() + 5 * HOUR) })]);
		await expect(payAtReader('res-1')).rejects.toMatchObject({ status: 400 });
		selectResults.push([booking({ paidAt: new Date() })]);
		await expect(payAtReader('res-1')).rejects.toMatchObject({ status: 400 });
		expect(startReaderPayment).not.toHaveBeenCalled();
	});

	it('is not there at all when no reader is configured', async () => {
		terminalReaderId.mockReturnValue(null);
		selectResults.push([booking()]);
		await expect(payAtReader('res-1')).rejects.toMatchObject({ status: 404 });
		expect(commitReservationCredits).not.toHaveBeenCalled();
	});

	it('settles on credits alone without touching the reader', async () => {
		commitReservationCredits.mockResolvedValue({
			creditUnits: 4,
			creditDiscountCents: 3000,
			remainingCents: 0,
			alreadyCommitted: false
		});
		selectResults.push([booking()]);
		await expect(payAtReader('res-1')).resolves.toEqual({ settled: true });
		expect(startReaderPayment).not.toHaveBeenCalled();
	});

	it('charges the remainder after credits, computed on the server', async () => {
		commitReservationCredits.mockResolvedValue({
			creditUnits: 2,
			creditDiscountCents: 1500,
			remainingCents: 1500,
			alreadyCommitted: false
		});
		selectResults.push([booking()]);
		await expect(payAtReader('res-1')).resolves.toEqual({
			settled: false,
			paymentIntentId: 'pi_reader'
		});
		expect(commitReservationCredits).toHaveBeenCalledWith(
			expect.objectContaining({ userId: member.id, reservationId: 'res-1', totalCents: 3000 })
		);
		expect(startReaderPayment).toHaveBeenCalledWith({
			reservationId: 'res-1',
			userId: member.id,
			amountCents: 1500
		});
	});

	it('charges what a confirmed booking still owes at the door', async () => {
		commitReservationCredits.mockResolvedValue({
			creditUnits: 0,
			creditDiscountCents: 2300,
			remainingCents: 700,
			alreadyCommitted: true
		});
		selectResults.push([booking({ status: 'confirmed', cashDueCents: 700 })]);
		await payAtReader('res-1');
		expect(startReaderPayment).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 700 }));
	});
});

describe('cancelling and simulating', () => {
	const args = { reservationId: 'res-1', paymentIntentId: 'pi_reader' };

	it('cancels only on the booking it was started for', async () => {
		selectResults.push([booking()]);
		await cancelPayAtReader(args);
		expect(cancelReaderPayment).toHaveBeenCalledWith('pi_reader', 'res-1');

		selectResults.push([booking({ createdByUserId: 'someone-else' })]);
		await expect(cancelPayAtReader(args)).rejects.toMatchObject({ status: 403 });
	});

	it('simulates a tap only where no real card can be charged', async () => {
		selectResults.push([booking()]);
		await simulatePayAtReader({ ...args, outcome: 'succeed' });
		expect(simulateReaderTap).toHaveBeenCalledWith('pi_reader', 'res-1', 'succeed');

		readerTapCanBeSimulated.mockReturnValue(false);
		selectResults.push([booking()]);
		await expect(simulatePayAtReader({ ...args, outcome: 'succeed' })).rejects.toMatchObject({
			status: 404
		});
	});
});
