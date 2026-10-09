import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockUser } from '$lib/server/db/test-factory';
import { ensureStripeCustomer } from '$lib/server/finance/stripe-customer-service';
import { recordCashPayment } from '$lib/server/finance/payment-service';

/**
 * Cash taken at the counter is recorded whether or not the member has ever
 * paid online, so a missing Stripe customer is created, not refused.
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

const { cashReceivedReservation } = (await import('$lib/remote/reservations.remote')) as any;

beforeEach(() => {
	selectResults.length = 0;
	vi.clearAllMocks();
	commitReservationCredits.mockImplementation(async (p: { totalCents: number }) => ({
		creditUnits: 0,
		creditDiscountCents: 0,
		remainingCents: p.totalCents,
		alreadyCommitted: false
	}));
});

describe('cashReceivedReservation', () => {
	it('records cash for a member who has no Stripe customer yet', async () => {
		const startsAt = new Date(Date.now() + HOUR);
		selectResults.push(
			[
				{
					createdByUserId: member.id,
					startsAt,
					endsAt: new Date(startsAt.getTime() + 2 * HOUR),
					bookerType: 'user'
				}
			],
			[{ email: member.email, name: member.name }]
		);

		await expect(cashReceivedReservation({ id: 'res-1' })).resolves.toEqual({ success: true });

		expect(ensureStripeCustomer).toHaveBeenCalledWith(member.id, member.email, member.name);
		expect(recordCashPayment).toHaveBeenCalledWith(
			expect.objectContaining({ stripeCustomerId: 'cus_1', amountCents: 3000 })
		);
	});
});
