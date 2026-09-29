import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isValidationError } from '@sveltejs/kit';
import { mockUser } from '$lib/server/db/test-factory';

// ---------------------------------------------------------------------------
// Mocks — mirrors src/routes/member/reservations/booking.remote.spec.ts
// ---------------------------------------------------------------------------

// Real error classes so `instanceof` checks in the remote resolve against the
// same mocked exports the service throws.
class ReservationConflictError extends Error {
	constructor() {
		super('Time slot is not available');
		this.name = 'ReservationConflictError';
	}
}
class ReservationValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ReservationValidationError';
	}
}
class ReservationStateError extends Error {
	constructor(message = 'Invalid reservation state') {
		super(message);
		this.name = 'ReservationStateError';
	}
}
class ReservationNotFoundError extends Error {
	constructor() {
		super('Reservation not found');
		this.name = 'ReservationNotFoundError';
	}
}
class ReservationAuthorizationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ReservationAuthorizationError';
	}
}

const reservationServiceMock = {
	staffCreate: vi.fn(async () => ({
		id: 'res-staff-1',
		status: 'confirmed',
		startsAt: new Date('2026-08-01T17:00:00'),
		endsAt: new Date('2026-08-01T19:00:00')
	})),
	create: vi.fn(),
	createWaitlisted: vi.fn(),
	cancel: vi.fn(),
	confirm: vi.fn(),
	markComplete: vi.fn(),
	markNoShow: vi.fn(),
	recordCashAndComplete: vi.fn(),
	ReservationConflictError,
	ReservationValidationError,
	ReservationStateError,
	ReservationNotFoundError,
	ReservationAuthorizationError
};

vi.mock('$lib/server/reservation/reservation-service', () => reservationServiceMock);

const creditServiceMock = {
	commitReservationCredits: vi.fn(async () => ({
		creditUnits: 2,
		creditDiscountCents: 1500,
		remainingCents: 1500,
		alreadyCommitted: false
	})),
	computeReservationCredit: vi.fn(() => ({
		creditUnits: 0,
		creditDiscountCents: 0,
		remainingCents: 0
	})),
	reverseReservationCredits: vi.fn()
};

vi.mock('$lib/server/reservation/reservation-credit-service', () => creditServiceMock);

vi.mock('$lib/server/reservation/timezone', () => ({
	formatDateInTz: vi.fn(() => ''),
	buildDateInTz: vi.fn((date: string, time: string) => new Date(`${date}T${time}:00`))
}));

// `termsFor` and `getBookingTerms` come through real: they are pure, and a
// stubbed rate resolver would let this spec pass while the resolver it is
// standing in for returned something else. Only the config *read* is faked.
vi.mock('$lib/server/reservation/config', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/reservation/config')>()),
	getReservationConfig: vi.fn(async () => ({ hourlyRateCents: 1500 }))
}));

// Only the conflict read is faked; the db mock below answers every select with
// a role row, which the real query would read as a double-booking.
const { getConflictDetails } = vi.hoisted(() => ({
	getConflictDetails: vi.fn(async (): Promise<unknown[]> => [])
}));
vi.mock('$lib/server/reservation/conflict-service', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/reservation/conflict-service')>()),
	getConflictDetails
}));

vi.mock('$lib/server/reservation/recurring-series-service', () => ({
	create: vi.fn(async () => ({ id: 'series-1' }))
}));

vi.mock('$lib/server/feature-flags', () => ({
	requireFeature: vi.fn(async () => undefined)
}));

// requireStaff() runs a real role query — one row is all hasAnyRole needs.
let selectResult: unknown[] = [{ name: 'staff' }];

function chainable() {
	const proxy: any = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				return (resolve: (v: unknown[]) => void) => resolve(selectResult);
			}
			return () => proxy;
		}
	});
	return proxy;
}

vi.mock('$lib/server/db', () => ({
	db: { select: () => chainable() }
}));

const staffUser = mockUser({ id: 'staff-1', name: 'Front Desk', email: 'staff@example.com' });

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		locals: { user: staffUser },
		url: new URL('http://localhost/staff/reservations'),
		request: { headers: new Headers() }
	}),
	form: (_schema: unknown, handler: (...args: any[]) => any) => {
		const fn = handler;
		(fn as any).__ = { type: 'form' };
		(fn as any).for = () => fn;
		return fn;
	},
	// A query call is a thenable with `refresh()`, as on the server, so a
	// handler's single-flight refreshes can be read back.
	query: (...args: unknown[]) => {
		const handler = (typeof args[0] === 'function' ? args[0] : args[1]) as (a?: unknown) => any;
		const fn: any = (arg?: unknown) => ({
			then: (res: any, rej: any) =>
				Promise.resolve()
					.then(() => handler(arg))
					.then(res, rej),
			refresh: async () => {
				refreshed.push({ query: fn, arg });
			}
		});
		fn.__ = { type: 'query' };
		return fn;
	}
}));

const { refreshed } = vi.hoisted(() => ({
	refreshed: [] as Array<{ query: unknown; arg: unknown }>
}));

const { createReservation, getStaffReservationDetail } =
	(await import('$lib/remote/reservations.remote')) as any;

// Mirrors SvelteKit's `issue` helper: it only builds the issue; `invalid()` throws.
const issue: any = new Proxy(
	{},
	{ get: (_t, field: string) => (message: string) => ({ message, path: [field] }) }
);

beforeEach(() => {
	vi.clearAllMocks();
	getConflictDetails.mockResolvedValue([]);
	refreshed.length = 0;
	selectResult = [{ name: 'staff' }];
});

// ---------------------------------------------------------------------------
// Staff create-on-behalf settles payment state (the "phantom Comped" bug)
// ---------------------------------------------------------------------------

describe('createReservation (staff)', () => {
	const input = {
		memberId: 'member-1',
		date: '2026-08-01',
		startTime: '17:00',
		endTime: '19:00'
	};

	it('records the acting staff member as the audit trail', async () => {
		await createReservation(input);

		expect(reservationServiceMock.staffCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: 'member-1',
				bookerId: 'member-1',
				staffUserId: 'staff-1'
			})
		);
	});

	it('commits the member credits so cashDueCents is never left null', async () => {
		await createReservation(input);

		// 2 hours × $15/hr — the same settle math as the member confirm path.
		expect(creditServiceMock.commitReservationCredits).toHaveBeenCalledWith({
			userId: 'member-1',
			reservationId: 'res-staff-1',
			totalCents: 3000,
			durationHours: 2,
			hourlyRateCents: 1500
		});
	});

	// #1669. With no explicit refresh, Kit answers a form submit with
	// invalidateAll(), which re-runs the modal's still-mounted conflict check
	// for the window just booked. It finds the new row and shows a
	// double-booking warning for a slot that was free.
	it('refreshes the booking it created, so the client does not invalidate the page', async () => {
		await createReservation(input);

		expect(refreshed).toEqual([{ query: getStaffReservationDetail, arg: 'res-staff-1' }]);
	});

	it('books for a member with no phone on file — staff creation is exempt', async () => {
		// The contact-phone gate is deliberately member-facing only: the front desk
		// can book a walk-in without stopping to collect contact details.
		await expect(createReservation(input)).resolves.toMatchObject({
			reservationId: 'res-staff-1'
		});
	});

	// #1688. The modal showed the double-booking warning but nothing stopped the
	// submit, and the remote never checked, so staff double-booked the room with
	// no deliberate step. Overriding is allowed; skipping the override is not.
	describe('over a conflicting booking or closure', () => {
		const booked = {
			type: 'reservation',
			id: 'res-other',
			startsAt: new Date('2026-08-01T18:00:00'),
			endsAt: new Date('2026-08-01T20:00:00'),
			label: 'Someone Else'
		};

		it('refuses without an explicit override', async () => {
			getConflictDetails.mockResolvedValue([booked]);

			let thrown: unknown;
			try {
				await createReservation(input, issue);
			} catch (e) {
				thrown = e;
			}

			expect(isValidationError(thrown)).toBe(true);
			const issues = (thrown as { issues: Array<{ path?: string[] }> }).issues;
			expect(issues.some((i) => i.path?.includes('overrideConflicts'))).toBe(true);
			expect(reservationServiceMock.staffCreate).not.toHaveBeenCalled();
		});

		it('books it when staff override', async () => {
			getConflictDetails.mockResolvedValue([booked]);

			await expect(
				createReservation({ ...input, overrideConflicts: true }, issue)
			).resolves.toMatchObject({ reservationId: 'res-staff-1' });
		});
	});
});
