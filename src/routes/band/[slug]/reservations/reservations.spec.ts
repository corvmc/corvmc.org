import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockUser } from '$lib/server/db/test-factory';
import { sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockBand = {
	id: 'band-1',
	name: 'The Velvet Underground',
	slug: 'the-velvet-underground',
	bio: 'NYC band',
	ownerId: 'user-owner',
	avatarKey: null,
	memberCount: 3,
	createdAt: new Date(),
	updatedAt: new Date()
};

const bandServiceMock = {
	getBySlug: vi.fn(async () => mockBand),
	getUserRole: vi.fn(async () => 'member' as string | null),
	getMembers: vi.fn(async () => [
		{ userId: 'user-owner', status: 'active' },
		{ userId: 'user-2', status: 'active' }
	])
};

vi.mock('$lib/server/band/band-service', () => bandServiceMock);

const conflictServiceMock = {
	getAvailableSlots: vi.fn(async () => [
		{ startTime: '09:00', endTime: '09:30', available: true },
		{ startTime: '09:30', endTime: '10:00', available: true },
		{ startTime: '10:00', endTime: '10:30', available: false }
	])
};

vi.mock('$lib/server/reservation/conflict-service', () => conflictServiceMock);

const reservationServiceMock = {
	create: vi.fn(async () => ({
		id: 'res-new',
		bookerType: 'band',
		bookerId: 'band-1',
		status: 'scheduled',
		startsAt: new Date(),
		endsAt: new Date()
	})),
	cancel: vi.fn(
		async (
			_id: string,
			_userId: string,
			_reason?: string,
			_options?: { staffOverride?: boolean; authorizedActor?: boolean }
		) => undefined
	)
};

vi.mock('$lib/server/reservation/reservation-service', () => reservationServiceMock);

vi.mock('$lib/server/reservation/timezone', () => ({
	buildDateInTz: vi.fn((date: string, time: string) => new Date(`${date}T${time}:00`))
}));

vi.mock('$lib/server/reservation/config', () => ({
	getReservationConfig: vi.fn(async () => ({
		timeSlotMinutes: 30,
		minDurationHours: 1,
		maxDurationHours: 8,
		operatingHoursStart: '09:00',
		operatingHoursEnd: '22:00',
		bufferMinutes: 0,
		maxAdvanceDaysOneoff: 14,
		maxAdvanceDaysRecurring: 17.5,
		hourlyRateCents: 1500
	}))
}));

vi.mock('$lib/server/db/schema/recurring', () => ({
	RECURRING_FREQUENCIES: ['weekly', 'biweekly', 'monthly']
}));

vi.mock('$lib/server/authorization', () => ({
	requireUser: vi.fn(() => ({ id: 'user-owner', name: 'Test Owner' })),
	hasAnyRole: vi.fn(async () => false),
	// `memberRefColumns()` selects this as a correlated subquery. The value is
	// never asserted here — only that building the projection doesn't throw.
	primaryRoleFor: vi.fn(() => sql`null`)
}));

vi.mock('$lib/server/feature-flags', () => ({
	requireFeature: vi.fn(async () => undefined)
}));

const subscriptionServiceMock = {
	getSubscription: vi.fn(async () => null as { id: string; status: string } | null),
	/** Same as `primaryRoleFor`: a SQL fragment `memberRefColumns()` projects. */
	isSustainingMemberSql: vi.fn(() => sql`0`)
};

vi.mock('$lib/server/finance/subscription-service', () => subscriptionServiceMock);

const recurringSeriesServiceMock = {
	create: vi.fn(async () => ({ id: 'series-1' }))
};

vi.mock('$lib/server/reservation/recurring-series-service', () => recurringSeriesServiceMock);

// Mock DB for page load
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
	db: {
		select: () => chainable()
	}
}));

// Contact-phone gate. Mocked at the service boundary, like reservation-service.
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
// recognisable error instead lets the spec assert on the field and message.
vi.mock('@sveltejs/kit', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@sveltejs/kit')>();
	return {
		...actual,
		invalid: (...issues: { name: string; message: string }[]) => {
			throw new InvalidError(issues);
		}
	};
});

const testUser = mockUser({ id: 'user-owner', name: 'Test Owner' });

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		locals: { user: testUser },
		params: { slug: 'the-velvet-underground' },
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

const {
	bookBandReservation: bookReservation,
	cancelBandReservation,
	getBandMembershipStatus,
	getBandReservations
} = (await import('$lib/remote/reservations.remote')) as any;

const { hasAnyRole } = (await import('$lib/server/authorization')) as unknown as {
	hasAnyRole: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
	vi.clearAllMocks();
	bandServiceMock.getUserRole.mockResolvedValue('member');
	ensureContactPhone.mockResolvedValue(true);
	hasAnyRole.mockResolvedValue(false);
	selectResult = [];
});

/** A row shaped like the entity-ref projection `getBandReservations` selects. */
function reservationRow(createdByUserId: string, status = 'scheduled') {
	return {
		id: 'res-1',
		status,
		startsAt: new Date(),
		endsAt: new Date(),
		notes: null,
		createdByUserId,
		ref: { id: 'res-1', startsAt: new Date(), endsAt: new Date(), status },
		bookedBy: { id: createdByUserId, name: 'Someone', email: null }
	};
}

/** The row `cancelBandReservation` reads before authorizing. */
function bandReservationRow(createdByUserId = 'user-owner', bookerId = 'band-1') {
	return [{ bookerType: 'band', bookerId, createdByUserId }];
}

// ---------------------------------------------------------------------------
// Remote handlers
// ---------------------------------------------------------------------------

describe('bookReservation', () => {
	it('creates reservation with band as booker', async () => {
		const result = await bookReservation({
			date: '2026-06-15',
			startTime: '09:00',
			endTime: '10:00'
		});

		expect(reservationServiceMock.create).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: 'user-owner',
				bookerType: 'band',
				bookerId: 'band-1'
			})
		);
		expect(result.reservationId).toBe('res-new');
	});

	it('passes notes through', async () => {
		await bookReservation({
			date: '2026-06-15',
			startTime: '09:00',
			endTime: '10:00',
			notes: 'Practice set list'
		});

		expect(reservationServiceMock.create).toHaveBeenCalledWith(
			expect.objectContaining({
				notes: 'Practice set list'
			})
		);
	});
});

describe('cancelBandReservation', () => {
	it('cancels a reservation the caller booked', async () => {
		selectResult = bandReservationRow('user-owner');

		const result = await cancelBandReservation({ reservationId: 'res-42' });

		expect(reservationServiceMock.cancel).toHaveBeenCalledWith(
			'res-42',
			'user-owner',
			undefined,
			undefined
		);
		expect(result.success).toBe(true);
	});

	// The page rendered Cancel on every row, but `cancel()` authorizes on
	// `createdByUserId` — so a bandmate who hadn't booked got an error toast from
	// a button they were offered. A band admin is allowed; a plain member is not.
	it('lets a band admin cancel a bandmate booking', async () => {
		bandServiceMock.getUserRole.mockResolvedValue('admin');
		selectResult = bandReservationRow('user-2');

		await cancelBandReservation({ reservationId: 'res-42' });

		expect(reservationServiceMock.cancel).toHaveBeenCalled();
	});

	it('refuses a plain member cancelling a bandmate booking', async () => {
		bandServiceMock.getUserRole.mockResolvedValue('member');
		selectResult = bandReservationRow('user-2');

		await expect(cancelBandReservation({ reservationId: 'res-42' })).rejects.toMatchObject({
			status: 403
		});
		expect(reservationServiceMock.cancel).not.toHaveBeenCalled();
	});

	// Nothing checked that the reservation belonged to the guarded band, so an id
	// from another band reached `cancel()` and was refused there — or, for a band
	// admin, would not have been.
	it('404s a reservation belonging to another band', async () => {
		bandServiceMock.getUserRole.mockResolvedValue('admin');
		selectResult = bandReservationRow('user-2', 'band-other');

		await expect(cancelBandReservation({ reservationId: 'res-42' })).rejects.toMatchObject({
			status: 404
		});
		expect(reservationServiceMock.cancel).not.toHaveBeenCalled();
	});

	it('404s a reservation that is not a band booking at all', async () => {
		bandServiceMock.getUserRole.mockResolvedValue('admin');
		selectResult = [{ bookerType: 'user', bookerId: 'user-2', createdByUserId: 'user-2' }];

		await expect(cancelBandReservation({ reservationId: 'res-42' })).rejects.toMatchObject({
			status: 404
		});
	});

	// `staffOverride` would ALSO waive the already-started check and stamp the
	// domain event `cancelledBy: 'staff'`, misattributing a member cancellation
	// in every downstream listener. The admin path must use the narrow option.
	it('uses authorizedActor and never staffOverride for a band admin', async () => {
		bandServiceMock.getUserRole.mockResolvedValue('admin');
		selectResult = bandReservationRow('user-2');

		await cancelBandReservation({ reservationId: 'res-42' });

		const options = reservationServiceMock.cancel.mock.calls[0][3];
		expect(options).toEqual({ authorizedActor: true });
		expect(options).not.toHaveProperty('staffOverride');
	});
});

// ---------------------------------------------------------------------------
// getBandReservations — previously `requireUser()` only, so any signed-in
// account could read any band's practice schedule, booker names and notes.
// ---------------------------------------------------------------------------

describe('getBandReservations', () => {
	it('returns upcoming and past for a member', async () => {
		const result = await getBandReservations('the-velvet-underground');

		expect(result).toHaveProperty('upcoming');
		expect(result).toHaveProperty('past');
	});

	it('refuses a signed-in non-member', async () => {
		bandServiceMock.getUserRole.mockResolvedValue(null);

		await expect(getBandReservations('the-velvet-underground')).rejects.toMatchObject({
			status: 403
		});
	});

	it('allows staff who are not band members', async () => {
		bandServiceMock.getUserRole.mockResolvedValue(null);
		hasAnyRole.mockResolvedValue(true);

		await expect(getBandReservations('the-velvet-underground')).resolves.toBeDefined();
	});

	// The guard resolves its band from `params.slug`; the query takes a slug of
	// its own. Without the cross-check those two could name different bands.
	it('refuses a slug that is not the guarded band', async () => {
		await expect(getBandReservations('some-other-band')).rejects.toMatchObject({ status: 403 });
	});

	it('marks a row cancellable only for its booker', async () => {
		selectResult = [reservationRow('user-2')];

		const result = await getBandReservations('the-velvet-underground');

		expect(result.upcoming[0].canCancel).toBe(false);
	});

	it('marks every row cancellable for a band admin', async () => {
		bandServiceMock.getUserRole.mockResolvedValue('admin');
		selectResult = [reservationRow('user-2')];

		const result = await getBandReservations('the-velvet-underground');

		expect(result.upcoming[0].canCancel).toBe(true);
	});

	// Past sessions are never cancellable, whoever is looking.
	it('never marks a past row cancellable', async () => {
		bandServiceMock.getUserRole.mockResolvedValue('owner');
		selectResult = [reservationRow('user-owner', 'completed')];

		const result = await getBandReservations('the-velvet-underground');

		expect(result.past[0].canCancel).toBe(false);
	});
});

describe('getBandMembershipStatus', () => {
	// Source queries the DB directly for an active member whose `subscription is not null`.
	// `selectResult` represents that query's result: a non-empty array means a sustaining
	// member was found.
	it('returns hasSustainingMember true when an active member has a subscription', async () => {
		selectResult = [{ id: 'user-owner' }];

		const result = await getBandMembershipStatus();

		expect(result.hasSustainingMember).toBe(true);
	});

	it('returns hasSustainingMember false when no active member has a subscription', async () => {
		selectResult = [];

		const result = await getBandMembershipStatus();

		expect(result.hasSustainingMember).toBe(false);
	});

	it('returns hasSustainingMember false when no active members exist', async () => {
		bandServiceMock.getMembers.mockResolvedValueOnce([{ userId: 'user-1', status: 'inactive' }]);

		const result = await getBandMembershipStatus();

		expect(result.hasSustainingMember).toBe(false);
	});
});

describe('bookReservation with recurring', () => {
	it('creates a recurring series when frequency is provided and member has sustaining subscription', async () => {
		// Non-empty result => a sustaining band member exists.
		selectResult = [{ id: 'user-owner' }];

		const result = await bookReservation({
			date: '2026-06-15',
			startTime: '09:00',
			endTime: '10:00',
			recurring: 'weekly'
		});

		expect(reservationServiceMock.create).toHaveBeenCalled();
		expect(recurringSeriesServiceMock.create).toHaveBeenCalledWith(
			expect.objectContaining({
				prototypeReservationId: 'res-new',
				frequency: 'weekly'
			})
		);
		expect(result.reservationId).toBe('res-new');
	});

	it('throws 403 when recurring is requested but no member has sustaining subscription', async () => {
		// Empty result => no sustaining band member.
		selectResult = [];

		await expect(
			bookReservation({
				date: '2026-06-15',
				startTime: '09:00',
				endTime: '10:00',
				recurring: 'monthly'
			})
		).rejects.toThrow();

		expect(recurringSeriesServiceMock.create).not.toHaveBeenCalled();
	});

	it('does not create series when recurring is empty string', async () => {
		await bookReservation({
			date: '2026-06-15',
			startTime: '09:00',
			endTime: '10:00',
			recurring: ''
		});

		expect(recurringSeriesServiceMock.create).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// Contact phone requirement
// ---------------------------------------------------------------------------

describe('bookReservation contact phone', () => {
	it('rejects the booking when the member has no usable number', async () => {
		ensureContactPhone.mockResolvedValue(false);

		await expect(
			bookReservation({ date: '2026-06-15', startTime: '09:00', endTime: '10:00' })
		).rejects.toMatchObject({
			issues: [{ name: 'phone', message: expect.stringContaining('phone number is required') }]
		});

		// No orphan reservation left behind by a rejected booking.
		expect(reservationServiceMock.create).not.toHaveBeenCalled();
	});

	it('gates on the booking member, not the band', async () => {
		await bookReservation({
			date: '2026-06-15',
			startTime: '09:00',
			endTime: '10:00',
			phone: '(541) 555-0123'
		});

		expect(ensureContactPhone).toHaveBeenCalledWith('user-owner', '(541) 555-0123');
	});
});
