import { describe, it, expect, vi, beforeEach } from 'vitest';
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

vi.mock('$lib/server/reservation/recurring-series-service', () => ({
	create: vi.fn(async () => ({ id: 'series-1' }))
}));

vi.mock('$lib/server/feature-flags', () => ({
	requireFeature: vi.fn(async () => undefined)
}));

// requireStaff() runs a real role query — one row is all hasAnyRole needs.
let selectResult: unknown[] = [{ roleId: 'role-staff' }];

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
	query: (...args: unknown[]) => {
		const handler = typeof args[0] === 'function' ? args[0] : args[1];
		const fn = handler as (...args: any[]) => any;
		(fn as any).__ = { type: 'query' };
		return fn;
	}
}));

const { createReservation } = (await import('$lib/remote/reservations.remote')) as any;

beforeEach(() => {
	vi.clearAllMocks();
	selectResult = [{ roleId: 'role-staff' }];
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

	it('books for a member with no phone on file — staff creation is exempt', async () => {
		// The contact-phone gate is deliberately member-facing only: the front desk
		// can book a walk-in without stopping to collect contact details.
		await expect(createReservation(input)).resolves.toMatchObject({
			reservationId: 'res-staff-1'
		});
	});
});
