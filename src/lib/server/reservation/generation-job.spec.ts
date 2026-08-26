import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock dependencies before importing the module under test
// ---------------------------------------------------------------------------

// DB mock — we use a queue-based approach: each call to .select() or .insert()
// pops the next result from selectResults or records an insert.
let selectResults: unknown[][] = [];
let insertedRows: unknown[] = [];

function makeSelectChain(result: unknown[]) {
	// Builds a fluent chain that resolves to result whether you call:
	//   .from().where()          (active series — no .limit())
	//   .from().where().limit()  (prototype, owner, existing instances)
	//   .from().where().limit()  (conflict checks)
	const limit = vi.fn().mockResolvedValue(result);
	// Make `where` thenable so `await .where()` works without `.limit()`
	const where = vi.fn().mockReturnValue(Object.assign(Promise.resolve(result), { limit }));
	const from = vi.fn().mockReturnValue({ where, limit });
	return { from };
}

const dbMock = {
	select: vi.fn(),
	insert: vi.fn(),
	update: vi.fn()
};

vi.mock('$lib/server/db', () => ({ db: dbMock }));

// Schema refs — just need to be truthy objects used in eq/and calls
vi.mock('$lib/server/db/schema/recurring', () => ({
	recurringSeries: {
		id: 'id',
		prototypeId: 'prototypeId',
		rrule: 'rrule',
		prototypeType: 'prototypeType',
		endsAt: 'endsAt',
		cancelledAt: 'cancelledAt',
		supersededBy: 'supersededBy'
	}
}));

vi.mock('$lib/server/db/schema/reservation', () => ({
	reservation: {
		id: 'id',
		bookerType: 'bookerType',
		bookerId: 'bookerId',
		createdByUserId: 'createdByUserId',
		startsAt: 'startsAt',
		endsAt: 'endsAt',
		notes: 'notes',
		recurringSeriesId: 'recurringSeriesId',
		status: 'status'
	},
	closure: { reason: 'reason', startsAt: 'startsAt', endsAt: 'endsAt' }
}));

vi.mock('$lib/server/db/schema/authentication', () => ({
	user: { id: 'id', name: 'name', email: 'email' }
}));

vi.mock('$lib/server/db/schema/event', () => ({
	event: {
		id: 'id',
		title: 'title',
		description: 'description',
		startsAt: 'startsAt',
		endsAt: 'endsAt',
		doorsAt: 'doorsAt',
		tags: 'tags',
		ticketingEnabled: 'ticketingEnabled',
		ticketPrice: 'ticketPrice',
		ticketQuantity: 'ticketQuantity',
		source: 'source',
		status: 'status',
		posterKey: 'posterKey',
		reservationId: 'reservationId',
		recurringSeriesId: 'recurringSeriesId',
		createdByUserId: 'createdByUserId'
	}
}));

const mockCopyObject = vi.fn();

vi.mock('$lib/server/storage', () => ({
	copyObject: (...args: unknown[]) => mockCopyObject(...args)
}));

const mockStaffCreate = vi.fn();
const mockHasConflict = vi.fn();

vi.mock('./reservation-service', () => ({
	staffCreate: (...args: unknown[]) => mockStaffCreate(...args)
}));

vi.mock('./conflict-service', () => ({
	hasConflict: (...args: unknown[]) => mockHasConflict(...args)
}));

vi.mock('$lib/server/sentry', () => ({
	captureException: vi.fn()
}));

vi.mock('drizzle-orm', () => ({
	eq: vi.fn(),
	and: vi.fn(),
	or: vi.fn(),
	isNull: vi.fn(),
	lt: vi.fn(),
	gt: vi.fn(),
	gte: vi.fn(),
	lte: vi.fn(),
	ne: vi.fn(),
	notInArray: vi.fn(),
	sql: vi.fn(() => 'sql')
}));

const mockGetOccurrences = vi.fn();
const mockGenerationWindowEnd = vi.fn();

vi.mock('./rrule-helpers', () => ({
	getOccurrences: (...args: unknown[]) => mockGetOccurrences(...args),
	generationWindowEnd: (...args: unknown[]) => mockGenerationWindowEnd(...args)
}));

vi.mock('./timezone', () => ({
	formatDateInTz: vi.fn().mockReturnValue('May 15'),
	formatTimeInTz: vi.fn().mockReturnValue('10:00 AM')
}));

const mockEmit = vi.fn().mockResolvedValue(undefined);

vi.mock('$lib/server/event-bus/event-bus', () => ({
	domainEvents: { emit: (...args: unknown[]) => mockEmit(...args) }
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const OCC1 = new Date('2026-05-20T17:00:00Z'); // occurrence start
const OCC1_END = new Date('2026-05-20T19:00:00Z'); // +2h

const PROTOTYPE = {
	bookerType: 'user',
	bookerId: 'user-1',
	createdByUserId: 'user-1',
	startsAt: new Date('2026-05-13T17:00:00Z'),
	endsAt: new Date('2026-05-13T19:00:00Z'), // 2h duration
	notes: 'Weekly practice'
};

const OWNER = { name: 'Alice Smith', email: 'alice@example.com' };

const SERIES = { id: 'series-1', prototypeId: 'proto-1', rrule: 'FREQ=WEEKLY', endsAt: null };

/** Push results onto the select queue in the order processSeries calls them */
function queueSelects(...results: unknown[][]) {
	selectResults = [...results];
	dbMock.select.mockImplementation(() => {
		const result = selectResults.shift() ?? [];
		return makeSelectChain(result);
	});
}

function setupInsert() {
	const values = vi.fn().mockImplementation((row: unknown) => {
		insertedRows.push(row);
		return Promise.resolve();
	});
	dbMock.insert.mockReturnValue({ values });
}

let updatedRows: unknown[] = [];

function setupUpdate() {
	updatedRows = [];
	const where = vi.fn().mockResolvedValue(undefined);
	const set = vi.fn().mockImplementation((row: unknown) => {
		updatedRows.push(row);
		return { where };
	});
	dbMock.update.mockReturnValue({ set });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// Import once at module scope (mocks above are hoisted by vi.mock). Importing
// inside each test made the first test pay the cold module-graph load within
// its 5s budget — on a loaded CI runner that times out, and the timed-out
// test's still-pending run then drains the next test's select queue.
const { generateRecurringReservations, generateRecurringEvents } = await import('./generation-job');

describe('generateRecurringReservations', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		selectResults = [];
		insertedRows = [];
		mockEmit.mockResolvedValue(undefined);
		mockGenerationWindowEnd.mockReturnValue(new Date('2026-06-20T00:00:00Z'));
	});

	it('returns zeros when no active series exist', async () => {
		// Only one select: the active series query → empty
		queueSelects([]);
		setupInsert();
		mockGetOccurrences.mockReturnValue([]);

		const result = await generateRecurringReservations();

		expect(result).toEqual({
			seriesProcessed: 0,
			instancesCreated: 0,
			instancesWaitlisted: 0,
			instancesSkipped: 0,
			errors: []
		});
	});

	it('creates reservation instances for occurrences with no conflicts', async () => {
		// Selects: activeSeries, prototype, owner, existingInstances, eventConflict, closureConflict, reservationConflict
		queueSelects(
			[SERIES], // 1. active series
			[PROTOTYPE], // 2. prototype reservation
			[OWNER], // 3. user/owner info
			[], // 4. existing instances in window (none)
			[], // 5. event conflict check (none)
			[], // 6. closure conflict check (none)
			[] // 7. regular reservation conflict check (none)
		);
		setupInsert();
		mockGetOccurrences.mockReturnValue([OCC1]);

		const result = await generateRecurringReservations();

		expect(result.seriesProcessed).toBe(1);
		expect(result.instancesCreated).toBe(1);
		expect(result.instancesSkipped).toBe(0);
		expect(result.errors).toHaveLength(0);
		expect(insertedRows).toHaveLength(1);
		expect(insertedRows[0]).toMatchObject({
			bookerType: PROTOTYPE.bookerType,
			bookerId: PROTOTYPE.bookerId,
			createdByUserId: PROTOTYPE.createdByUserId,
			status: 'scheduled',
			startsAt: OCC1,
			endsAt: OCC1_END,
			notes: PROTOTYPE.notes,
			recurringSeriesId: SERIES.id
		});
	});

	it('skips occurrences that already exist (dedup)', async () => {
		// existingInstances returns OCC1 → it already exists
		queueSelects(
			[SERIES],
			[PROTOTYPE],
			[OWNER],
			[{ startsAt: OCC1 }] // 4. existing instance matches OCC1
			// No conflict-check selects because we short-circuit on dedup
		);
		setupInsert();
		mockGetOccurrences.mockReturnValue([OCC1]);

		const result = await generateRecurringReservations();

		expect(result.instancesCreated).toBe(0);
		expect(result.instancesSkipped).toBe(0); // deduped, not counted as skipped
		expect(insertedRows).toHaveLength(0);
	});

	it('skips occurrences with event conflicts and emits recurring_skipped event', async () => {
		queueSelects(
			[SERIES],
			[PROTOTYPE],
			[OWNER],
			[], // 4. no existing instances
			[{ id: 'event-1' }], // 5. event conflict found
			[] // closure check (not reached, but queue is safe)
		);
		setupInsert();
		mockGetOccurrences.mockReturnValue([OCC1]);

		const result = await generateRecurringReservations();

		expect(result.instancesCreated).toBe(0);
		expect(result.instancesSkipped).toBe(1);
		expect(insertedRows).toHaveLength(0);

		expect(mockEmit).toHaveBeenCalledOnce();
		expect(mockEmit).toHaveBeenCalledWith(
			'reservation.recurring_skipped',
			expect.objectContaining({
				seriesId: SERIES.id,
				userId: PROTOTYPE.createdByUserId,
				userName: OWNER.name,
				userEmail: OWNER.email,
				reason: 'Scheduled event'
			})
		);
	});

	it('skips occurrences with closure conflicts', async () => {
		queueSelects(
			[SERIES],
			[PROTOTYPE],
			[OWNER],
			[], // 4. no existing instances
			[], // 5. no event conflict
			[{ reason: 'Holiday closure' }] // 6. closure conflict
		);
		setupInsert();
		mockGetOccurrences.mockReturnValue([OCC1]);

		const result = await generateRecurringReservations();

		expect(result.instancesCreated).toBe(0);
		expect(result.instancesSkipped).toBe(1);
		expect(insertedRows).toHaveLength(0);

		expect(mockEmit).toHaveBeenCalledOnce();
		expect(mockEmit).toHaveBeenCalledWith(
			'reservation.recurring_skipped',
			expect.objectContaining({ reason: 'Holiday closure' })
		);
	});

	it('catches per-series errors without stopping other series', async () => {
		const SERIES_2 = { id: 'series-2', prototypeId: 'proto-2', rrule: 'FREQ=WEEKLY', endsAt: null };
		const OCC2 = new Date('2026-05-21T17:00:00Z');
		const OCC2_END = new Date('2026-05-21T19:00:00Z');

		queueSelects(
			[SERIES, SERIES_2], // 1. two active series
			[], // 2. prototype for series-1 → missing → throws
			// series-2 processing:
			[PROTOTYPE], // 3. prototype for series-2
			[OWNER], // 4. owner for series-2
			[], // 5. no existing instances
			[], // 6. no event conflict for OCC2
			[], // 7. no closure conflict for OCC2
			[] // 8. no regular reservation conflict for OCC2
		);
		setupInsert();

		// series-1 gets no occurrences because it throws before reaching getOccurrences
		// series-2 gets one occurrence
		mockGetOccurrences.mockReturnValueOnce([OCC2]); // called only for series-2

		const result = await generateRecurringReservations();

		expect(result.seriesProcessed).toBe(1);
		expect(result.instancesCreated).toBe(1);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toContain('series-1');
		expect(result.errors[0]).toContain('Prototype reservation not found');

		expect(insertedRows).toHaveLength(1);
		expect(insertedRows[0]).toMatchObject({
			startsAt: OCC2,
			endsAt: OCC2_END,
			recurringSeriesId: SERIES_2.id
		});
	});

	it('creates waitlisted instances when regular reservation conflicts exist', async () => {
		queueSelects(
			[SERIES], // 1. active series
			[PROTOTYPE], // 2. prototype reservation
			[OWNER], // 3. user/owner info
			[], // 4. existing instances in window (none)
			[], // 5. no event conflict
			[], // 6. no closure conflict
			[{ id: 'res-99' }] // 7. regular reservation conflict found
		);
		setupInsert();
		mockGetOccurrences.mockReturnValue([OCC1]);

		const result = await generateRecurringReservations();

		expect(result.seriesProcessed).toBe(1);
		expect(result.instancesCreated).toBe(0);
		expect(result.instancesWaitlisted).toBe(1);
		expect(result.instancesSkipped).toBe(0);
		expect(result.errors).toHaveLength(0);
		expect(insertedRows).toHaveLength(1);
		expect(insertedRows[0]).toMatchObject({
			bookerType: PROTOTYPE.bookerType,
			bookerId: PROTOTYPE.bookerId,
			createdByUserId: PROTOTYPE.createdByUserId,
			status: 'waitlisted',
			startsAt: OCC1,
			endsAt: OCC1_END,
			notes: PROTOTYPE.notes,
			recurringSeriesId: SERIES.id
		});

		expect(mockEmit).toHaveBeenCalledOnce();
		expect(mockEmit).toHaveBeenCalledWith(
			'reservation.recurring_waitlisted',
			expect.objectContaining({
				seriesId: SERIES.id,
				userId: PROTOTYPE.createdByUserId,
				userName: OWNER.name,
				userEmail: OWNER.email,
				reason: 'Time slot is currently booked'
			})
		);
	});

	it('handles missing prototype gracefully (adds to errors)', async () => {
		queueSelects(
			[SERIES], // 1. one active series
			[] // 2. prototype query → empty → throws
		);
		setupInsert();
		// getOccurrences should not be called; no need to configure it

		const result = await generateRecurringReservations();

		expect(result.seriesProcessed).toBe(0);
		expect(result.instancesCreated).toBe(0);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toMatch(/series-1.*Prototype reservation not found/);
		expect(mockEmit).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// Event generation
// ---------------------------------------------------------------------------

const EVENT_SERIES = {
	id: 'eseries-1',
	prototypeId: 'eproto-1',
	rrule: 'FREQ=WEEKLY',
	endsAt: null
};

/** Prototype event with a linked reservation (space reserved). */
const EVENT_PROTO = {
	id: 'eproto-1',
	title: 'Weekly Open Mic',
	description: 'Sign up at the door',
	startsAt: new Date('2026-05-13T17:00:00Z'),
	endsAt: new Date('2026-05-13T19:00:00Z'), // 2h duration
	doorsAt: new Date('2026-05-13T16:30:00Z'),
	tags: 'open mic',
	ticketingEnabled: true,
	ticketPrice: 1000,
	ticketQuantity: 40,
	source: 'cmc',
	createdByUserId: 'user-1',
	reservationId: 'eres-proto'
};

/** The prototype's reservation window: starts 30m before, ends 30m after the event. */
const EVENT_PROTO_RES = {
	startsAt: new Date('2026-05-13T16:30:00Z'),
	endsAt: new Date('2026-05-13T19:30:00Z')
};

describe('generateRecurringEvents', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		selectResults = [];
		insertedRows = [];
		updatedRows = [];
		mockEmit.mockResolvedValue(undefined);
		mockGenerationWindowEnd.mockReturnValue(new Date('2026-06-20T00:00:00Z'));
		mockStaffCreate.mockResolvedValue({ id: 'eres-new' });
		mockHasConflict.mockResolvedValue(false);
		mockCopyObject.mockResolvedValue(null);
	});

	it('creates a draft event and books space for an unconflicted occurrence', async () => {
		queueSelects(
			[EVENT_SERIES], // 1. active event series
			[EVENT_PROTO], // 2. prototype event
			[OWNER], // 3. owner
			[EVENT_PROTO_RES], // 4. prototype reservation window
			[] // 5. existing instances (none)
		);
		setupInsert();
		setupUpdate();
		mockGetOccurrences.mockReturnValue([OCC1]);

		const result = await generateRecurringEvents();

		expect(result.seriesProcessed).toBe(1);
		expect(result.instancesCreated).toBe(1);
		expect(result.instancesSkipped).toBe(0);
		expect(result.errors).toHaveLength(0);

		// Draft event copies prototype config with shifted times
		expect(insertedRows).toHaveLength(1);
		expect(insertedRows[0]).toMatchObject({
			title: EVENT_PROTO.title,
			description: EVENT_PROTO.description,
			startsAt: OCC1,
			endsAt: OCC1_END,
			doorsAt: new Date(OCC1.getTime() - 30 * 60 * 1000),
			ticketingEnabled: true,
			ticketPrice: 1000,
			ticketQuantity: 40,
			source: 'cmc',
			status: 'draft',
			recurringSeriesId: EVENT_SERIES.id
		});

		// Space reserved for this occurrence (30m lead/tail preserved)
		expect(mockHasConflict).toHaveBeenCalledOnce();
		expect(mockStaffCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				bookerType: 'event',
				// Matches the one-off path: event-booked space is staff-held, so it
				// must not look like an uncommitted member booking.
				status: 'confirmed',
				startsAt: new Date(OCC1.getTime() - 30 * 60 * 1000),
				endsAt: new Date(OCC1_END.getTime() + 30 * 60 * 1000)
			})
		);
		// The event is linked to the new reservation
		expect(updatedRows[0]).toMatchObject({ reservationId: 'eres-new' });
	});

	it('still creates the draft event but skips reservation when the slot conflicts', async () => {
		queueSelects([EVENT_SERIES], [EVENT_PROTO], [OWNER], [EVENT_PROTO_RES], []);
		setupInsert();
		setupUpdate();
		mockGetOccurrences.mockReturnValue([OCC1]);
		mockHasConflict.mockResolvedValue(true);

		const result = await generateRecurringEvents();

		expect(result.instancesCreated).toBe(1); // event still created
		expect(result.instancesSkipped).toBe(1); // space not booked
		expect(insertedRows).toHaveLength(1);
		expect(mockStaffCreate).not.toHaveBeenCalled();
		expect(updatedRows).toHaveLength(0);

		expect(mockEmit).toHaveBeenCalledWith(
			'event.recurring_reservation_skipped',
			expect.objectContaining({
				seriesId: EVENT_SERIES.id,
				eventTitle: EVENT_PROTO.title,
				userId: EVENT_PROTO.createdByUserId
			})
		);
	});

	it('skips occurrences that already exist (idempotent)', async () => {
		queueSelects(
			[EVENT_SERIES],
			[EVENT_PROTO],
			[OWNER],
			[EVENT_PROTO_RES],
			[{ startsAt: OCC1 }] // existing instance matches OCC1
		);
		setupInsert();
		setupUpdate();
		mockGetOccurrences.mockReturnValue([OCC1]);

		const result = await generateRecurringEvents();

		expect(result.instancesCreated).toBe(0);
		expect(insertedRows).toHaveLength(0);
		expect(mockStaffCreate).not.toHaveBeenCalled();
	});

	it('does not book space when the prototype has no reservation', async () => {
		const protoNoRes = { ...EVENT_PROTO, reservationId: null };
		queueSelects(
			[EVENT_SERIES],
			[protoNoRes],
			[OWNER],
			// no prototype-reservation select because reservationId is null
			[] // existing instances
		);
		setupInsert();
		setupUpdate();
		mockGetOccurrences.mockReturnValue([OCC1]);

		const result = await generateRecurringEvents();

		expect(result.instancesCreated).toBe(1);
		expect(result.instancesSkipped).toBe(0);
		expect(mockHasConflict).not.toHaveBeenCalled();
		expect(mockStaffCreate).not.toHaveBeenCalled();
	});

	it('copies the prototype poster to a per-occurrence key', async () => {
		const protoWithPoster = {
			...EVENT_PROTO,
			reservationId: null,
			posterKey: 'events/posters/eproto-1.webp'
		};
		queueSelects([EVENT_SERIES], [protoWithPoster], [OWNER], []);
		setupInsert();
		setupUpdate();
		mockGetOccurrences.mockReturnValue([OCC1]);
		mockCopyObject.mockResolvedValue('events/posters/copied.webp');

		await generateRecurringEvents();

		// Copied from the prototype key to a key under the new event id, preserving ext
		expect(mockCopyObject).toHaveBeenCalledOnce();
		const [srcKey, destKey] = mockCopyObject.mock.calls[0];
		expect(srcKey).toBe('events/posters/eproto-1.webp');
		expect(destKey).toMatch(/^events\/posters\/.+\.webp$/);
		// The occurrence is updated with the copied poster key
		expect(updatedRows[0]).toMatchObject({ posterKey: 'events/posters/copied.webp' });
	});
});
