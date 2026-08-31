import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockUser } from '$lib/server/db/test-factory';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Real error class so the remote's `instanceof ReservationConflictError` check
// matches what create() throws (both resolve to this same mocked export).
class ReservationConflictError extends Error {
	constructor() {
		super('Time slot is not available');
		this.name = 'ReservationConflictError';
	}
}

// Real error class so the remote's `instanceof ReservationValidationError` check
// matches what create() throws (both resolve to this same mocked export).
class ReservationValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ReservationValidationError';
	}
}

// Also imported by the shared mapDomainError() (src/lib/server/errors.ts). Stubbed
// so its `instanceof` checks resolve instead of throwing "no export" from the mock.
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
	constructor(message = 'Not authorized') {
		super(message);
		this.name = 'ReservationAuthorizationError';
	}
}

const reservationServiceMock = {
	staffCreate: vi.fn(),
	create: vi.fn(async () => {
		throw new ReservationConflictError();
	}),
	createWaitlisted: vi.fn(async () => ({
		id: 'res-waitlisted',
		status: 'waitlisted',
		startsAt: new Date(),
		endsAt: new Date()
	})),
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

const recurringSeriesServiceMock = {
	create: vi.fn(async () => ({ id: 'series-1' }))
};

vi.mock('$lib/server/reservation/recurring-series-service', () => recurringSeriesServiceMock);

vi.mock('$lib/server/feature-flags', () => ({
	requireFeature: vi.fn(async () => undefined)
}));

// Mock DB — the recurring path reads the member's subscription to gate the flow.
let selectResult: unknown[] = [];

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

// Contact-phone gate. Mocked at the service boundary (like reservation-service
// above) so these tests stay about the handler wiring, not the DB read/write.
const ensureContactPhone = vi.fn(async () => true);
vi.mock('$lib/server/user/user-service', () => ({ ensureContactPhone }));

/** Stands in for the `issue` helper SvelteKit hands the form handler. */
const issueProxy = new Proxy(
	{},
	{ get: (_t, name: string) => (message: string) => ({ name, message }) }
);

class InvalidError extends Error {
	issues: { name: string; message: string }[];
	constructor(issues: { name: string; message: string }[]) {
		super('invalid');
		this.issues = issues;
	}
}

// `invalid()` needs a request context to build its real response; throwing a
// recognisable error instead lets the specs assert on the field and message.
vi.mock('@sveltejs/kit', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@sveltejs/kit')>();
	return {
		...actual,
		invalid: (...issues: { name: string; message: string }[]) => {
			throw new InvalidError(issues);
		}
	};
});

const testUser = mockUser({ id: 'user-1', name: 'Test Member', email: 'member@example.com' });

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		locals: { user: testUser },
		url: new URL('http://localhost/member/reservations'),
		request: { headers: new Headers() }
	}),
	form: (_schema: unknown, handler: (...args: any[]) => any) => {
		const fn = (data: unknown) => handler(data, issueProxy);
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

const { bookAndPayReservation, bookMemberReservation } =
	(await import('$lib/remote/reservations.remote')) as any;

beforeEach(() => {
	vi.clearAllMocks();
	ensureContactPhone.mockResolvedValue(true);
	selectResult = [];
	reservationServiceMock.create.mockImplementation(async () => {
		throw new ReservationConflictError();
	});
});

// ---------------------------------------------------------------------------
// Slot conflict handling
// ---------------------------------------------------------------------------

describe('bookAndPayReservation slot conflict', () => {
	it('returns a conflict signal (not a 500) when a one-time slot is taken', async () => {
		const result = await bookAndPayReservation({
			date: '2026-06-15',
			startTime: '09:00',
			endTime: '10:00',
			skipPayment: 'on'
		});

		expect(result).toEqual({ conflict: true });
		// No fallback write: create() conflicts before inserting, so nothing is created.
		expect(reservationServiceMock.createWaitlisted).not.toHaveBeenCalled();
	});

	it('surfaces a validation error (not a 500) when the slot is out of the booking window', async () => {
		reservationServiceMock.create.mockImplementation(async () => {
			throw new ReservationValidationError('Cannot book more than 14 days in advance');
		});

		const result = await bookAndPayReservation({
			date: '2026-08-01',
			startTime: '09:00',
			endTime: '10:00',
			skipPayment: 'on'
		});

		expect(result).toEqual({
			validationError: 'Cannot book more than 14 days in advance'
		});
		// Nothing was created, so no waitlist fallback either.
		expect(reservationServiceMock.createWaitlisted).not.toHaveBeenCalled();
	});

	it('waitlists a recurring booking when the first instance conflicts', async () => {
		// Non-empty subscription row => sustaining member (recurring is allowed).
		selectResult = [{ subscription: { id: 'sub-1' } }];

		const result = await bookAndPayReservation({
			date: '2026-06-15',
			startTime: '09:00',
			endTime: '10:00',
			recurring: 'weekly',
			skipPayment: 'on'
		});

		expect(reservationServiceMock.createWaitlisted).toHaveBeenCalled();
		expect(recurringSeriesServiceMock.create).toHaveBeenCalled();
		expect(result).toMatchObject({ waitlisted: true });
	});
});

// ---------------------------------------------------------------------------
// Non-wizard forms map domain errors to HTTP status (via mapDomainError) rather
// than the wizard's in-band { validationError } signal or a raw 500.
// ---------------------------------------------------------------------------

describe('bookMemberReservation domain-error mapping', () => {
	it('maps a one-time slot conflict to a 409 (not a 500)', async () => {
		// Default mock: create() throws ReservationConflictError.
		await expect(
			bookMemberReservation({ date: '2026-06-15', startTime: '09:00', endTime: '10:00' })
		).rejects.toMatchObject({ status: 409 });
	});

	it('maps an out-of-window validation error to a 400 (not a 500)', async () => {
		reservationServiceMock.create.mockImplementation(async () => {
			throw new ReservationValidationError('Cannot book more than 14 days in advance');
		});

		await expect(
			bookMemberReservation({ date: '2026-08-01', startTime: '09:00', endTime: '10:00' })
		).rejects.toMatchObject({ status: 400 });
	});
});

// ---------------------------------------------------------------------------
// Contact phone requirement
// ---------------------------------------------------------------------------

describe('contact phone requirement', () => {
	it('rejects a booking with no usable number, before any row is written', async () => {
		ensureContactPhone.mockResolvedValue(false);

		await expect(
			bookAndPayReservation({ date: '2026-06-15', startTime: '09:00', endTime: '10:00' })
		).rejects.toMatchObject({
			issues: [{ name: 'phone', message: expect.stringContaining('phone number is required') }]
		});

		// No orphan reservation left behind by a rejected booking.
		expect(reservationServiceMock.create).not.toHaveBeenCalled();
		expect(reservationServiceMock.createWaitlisted).not.toHaveBeenCalled();
	});

	it('passes a submitted number through to be saved, then books', async () => {
		// The mock's default implementation throws, so its inferred return type is
		// `never` — cast to override it for the success path.
		reservationServiceMock.create.mockImplementation((async () => ({
			id: 'res-1',
			status: 'scheduled',
			startsAt: new Date(),
			endsAt: new Date()
		})) as never);

		const result = await bookMemberReservation({
			date: '2026-06-15',
			startTime: '09:00',
			endTime: '10:00',
			phone: '(541) 555-0123'
		});

		expect(ensureContactPhone).toHaveBeenCalledWith('user-1', '(541) 555-0123');
		expect(result).toMatchObject({ reservationId: 'res-1' });
	});
});
