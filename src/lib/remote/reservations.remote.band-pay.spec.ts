import { describe, it, expect, vi, beforeEach } from 'vitest';
import { error, isHttpError, isRedirect } from '@sveltejs/kit';
import { mockUser } from '$lib/server/db/test-factory';
import { reservation } from '$lib/server/db/schema/reservation';
import { user } from '$lib/server/db/schema/authentication';

// #2095: any active member of the booking band may pay a band session; the
// booker's free hours settle it first, and the payer is charged the rest.

const booker = mockUser({ id: 'booker-1', name: 'Booker', email: 'booker@example.com' });
const bandmate = mockUser({ id: 'mate-1', name: 'Mate', email: 'mate@example.com' });
const outsider = mockUser({ id: 'out-1', name: 'Outsider', email: 'out@example.com' });
const band = { id: 'band-1', slug: 'the-band' };

let currentUser = bandmate;
const bandMemberIds = new Set([booker.id, bandmate.id]);

const DAY = 24 * 60 * 60 * 1000;
const startsAt = new Date(Date.now() + 3 * DAY);
const endsAt = new Date(startsAt.getTime() + 2 * 60 * 60 * 1000);
const dateStr = startsAt.toISOString().slice(0, 10);

const bandRow = () => ({
	id: 'res-1',
	bookerType: 'group',
	bookerId: band.id,
	createdByUserId: booker.id,
	status: 'scheduled',
	startsAt,
	endsAt,
	notes: null,
	paidAt: null,
	cashDueCents: null,
	creditsUsed: null
});

// Rows served per table, so the reservation read and the booker lookup differ.
const rows = new Map<unknown, unknown[]>();
vi.mock('$lib/server/db', () => ({
	db: {
		select: () => {
			let table: unknown;
			const c: Record<string, unknown> = {
				from: (t: unknown) => ((table = t), c),
				where: () => c,
				limit: () => Promise.resolve(rows.get(table) ?? [])
			};
			return c;
		},
		update: () => ({ set: () => ({ where: () => Promise.resolve() }) })
	}
}));

vi.mock('$lib/server/authorization', () => ({
	can: vi.fn(async () => false),
	requireCapability: vi.fn(),
	requireCapabilityOrOwner: vi.fn(),
	requireUser: () => currentUser
}));

const requireGroupRole = vi.fn(async (ref: { id?: string; slug?: string }) => {
	if (ref.id !== undefined && ref.id !== band.id) throw error(404, 'Not found');
	if (ref.slug !== undefined && ref.slug !== band.slug) throw error(404, 'Not found');
	if (!bandMemberIds.has(currentUser.id)) throw error(403, 'Not a member of this group');
	return { user: currentUser, group: band, role: 'member' };
});
vi.mock('$lib/server/group/group-context', () => ({
	requireGroupRole: (...a: unknown[]) => requireGroupRole(...(a as [{ id?: string }]))
}));

vi.mock('$lib/server/reservation/config', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/reservation/config')>()),
	getReservationConfig: vi.fn(async () => ({ hourlyRateCents: 1500 })),
	getBookingTerms: vi.fn(async () => ({ hourlyRateCents: 1500 }))
}));

vi.mock('$lib/server/reservation/timezone', () => ({
	formatDateInTz: vi.fn(() => ''),
	buildDateInTz: vi.fn(() => startsAt)
}));

// Each person's wallet, in 30-minute credits: the booker has one free hour.
const wallets: Record<string, number> = { [booker.id]: 2, [bandmate.id]: 8, [outsider.id]: 8 };
const getFreeHoursWallet = vi.fn(async (id: string) => ({
	balance: wallets[id] ?? 0,
	resetAt: new Date(startsAt.getTime() + 7 * DAY)
}));
const commitReservationCredits = vi.fn();
vi.mock('$lib/server/reservation/reservation-credit-service', async (importOriginal) => {
	const actual =
		await importOriginal<typeof import('$lib/server/reservation/reservation-credit-service')>();
	commitReservationCredits.mockImplementation(
		async (p: {
			userId: string;
			totalCents: number;
			durationHours: number;
			hourlyRateCents: number;
		}) => ({
			...actual.computeReservationCredit({ ...p, freeHoursBalance: wallets[p.userId] ?? 0 }),
			alreadyCommitted: false
		})
	);
	return {
		...actual,
		getFreeHoursWallet: (id: string) => getFreeHoursWallet(id),
		commitReservationCredits,
		reverseReservationCredits: vi.fn()
	};
});

vi.mock('$lib/server/finance/reservation-entries', () => ({
	recordReservationCredit: vi.fn(async () => undefined),
	recordReservationCash: vi.fn(),
	recordReservationCardPresent: vi.fn()
}));

// Stripe is never reached for real.
const checkout = vi.fn(async (_o: Record<string, unknown>) => ({
	paid: false,
	checkoutUrl: 'https://checkout.test/session'
}));
vi.mock('$lib/server/finance/payment-service', () => ({
	checkout: (o: Record<string, unknown>) => checkout(o),
	recordCashPayment: vi.fn(async () => ({ paymentRecordId: 'rec-0' })),
	refund: vi.fn()
}));
const ensureStripeCustomer = vi.fn(async (..._a: unknown[]) => 'cus_test');
vi.mock('$lib/server/finance/stripe-customer-service', () => ({
	ensureStripeCustomer: (...a: unknown[]) => ensureStripeCustomer(...a)
}));

const create = vi.fn(async () => bandRow());
vi.mock('$lib/server/reservation/reservation-service', () => ({
	create: () => create(),
	createWaitlisted: vi.fn(),
	announceConfirmed: vi.fn(async () => undefined),
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
		locals: { user: currentUser },
		params: { id: 'res-1' },
		url: new URL('http://localhost/member/reservations/res-1/pay'),
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

const { payReservation, getReservationPayment, bookBandReservation } =
	(await import('$lib/remote/reservations.remote')) as any;

async function settle(p: Promise<unknown>): Promise<unknown> {
	try {
		return await p;
	} catch (e) {
		return e;
	}
}

beforeEach(() => {
	vi.clearAllMocks();
	rows.clear();
	rows.set(reservation, [bandRow()]);
	rows.set(user, [{ email: booker.email, name: booker.name }]);
	currentUser = bandmate;
});

describe('a band booking, paid by someone who did not book it', () => {
	it('refuses a non-member on the pay page before any charge', async () => {
		currentUser = outsider;
		const e = await settle(getReservationPayment('res-1'));
		expect(isHttpError(e) && e.status).toBe(403);

		const p = await settle(payReservation({ coverFees: false }));
		expect(isHttpError(p) && p.status).toBe(403);
		expect(commitReservationCredits).not.toHaveBeenCalled();
		expect(checkout).not.toHaveBeenCalled();
	});

	it("refuses a stranger to someone else's solo booking without a band lookup", async () => {
		rows.set(reservation, [{ ...bandRow(), bookerType: 'user', bookerId: booker.id }]);
		const p = await settle(payReservation({ coverFees: false }));
		expect(isHttpError(p) && p.status).toBe(403);
		expect(requireGroupRole).not.toHaveBeenCalled();
		expect(checkout).not.toHaveBeenCalled();
	});

	it("quotes a bandmate the booker's free hours, resolving the band from the row", async () => {
		const data = await getReservationPayment('res-1');
		expect(requireGroupRole).toHaveBeenCalledWith({ id: band.id }, 'member');
		expect(getFreeHoursWallet).toHaveBeenCalledWith(booker.id);
		expect(getFreeHoursWallet).not.toHaveBeenCalledWith(bandmate.id);
		expect(data.freeHoursBalance).toBe(2);
	});

	it("admits a bandmate: the booker's free hours settle first, the payer is charged the rest", async () => {
		const r = await settle(payReservation({ coverFees: false }));
		expect(isRedirect(r) && r.location).toBe('https://checkout.test/session');

		expect(commitReservationCredits).toHaveBeenCalledTimes(1);
		expect(commitReservationCredits).toHaveBeenCalledWith(
			expect.objectContaining({ userId: booker.id, reservationId: 'res-1' })
		);
		expect(checkout).toHaveBeenCalledTimes(1);
		const opts = checkout.mock.calls[0][0] as any;
		expect(opts.userId).toBe(bandmate.id);
		expect(opts.customerEmail).toBe(bandmate.email);
		// Two hours at $15, one covered by the booker's free hours.
		expect(opts.lineItems[0].price_data.unit_amount).toBe(1500);
		expect(opts.successUrl).toContain('/band/the-band/reservations');
	});
});

describe('bookBandReservation with a pay step', () => {
	const booking = {
		slug: band.slug,
		date: dateStr,
		startTime: '09:00',
		endTime: '11:00',
		coverFees: false,
		payNow: 'on'
	};

	it('refuses a non-member before booking or charging', async () => {
		currentUser = outsider;
		const r = await settle(bookBandReservation(booking));
		expect(isHttpError(r) && r.status).toBe(403);
		expect(create).not.toHaveBeenCalled();
		expect(checkout).not.toHaveBeenCalled();
	});

	it('charges the booker the remainder after their own free hours', async () => {
		currentUser = booker;
		const r = await bookBandReservation(booking);
		expect(r).toMatchObject({
			reservationId: 'res-1',
			redirectUrl: 'https://checkout.test/session'
		});
		expect(commitReservationCredits).toHaveBeenCalledWith(
			expect.objectContaining({ userId: booker.id })
		);
		expect((checkout.mock.calls[0][0] as any).lineItems[0].price_data.unit_amount).toBe(1500);
	});

	it('takes no payment when booked without the pay step', async () => {
		currentUser = booker;
		const r = await bookBandReservation({ ...booking, payNow: undefined });
		expect(r).toMatchObject({ reservationId: 'res-1', waitlisted: false });
		expect(commitReservationCredits).not.toHaveBeenCalled();
		expect(checkout).not.toHaveBeenCalled();
	});
});
