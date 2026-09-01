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

// `__table` is how `insertTableName` tells these apart. The real tables carry a
// `drizzle:Name` symbol, but these stand-ins are plain objects, so the
// discriminator has to be one they actually have.
vi.mock('$lib/server/db/schema/event', () => ({
	event: {
		__table: 'event',
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
		groupId: 'groupId',
		location: 'location',
		publishedAt: 'publishedAt',
		status: 'status',
		posterKey: 'posterKey',
		reservationId: 'reservationId',
		recurringSeriesId: 'recurringSeriesId',
		createdByUserId: 'createdByUserId'
	},
	eventBand: { __table: 'event_band', id: 'id', eventId: 'eventId', bandId: 'bandId' },
	eventGroup: { __table: 'event_group', id: 'id', eventId: 'eventId', groupId: 'groupId' }
}));

vi.mock('$lib/server/db/schema/group', () => ({
	group: { __table: 'group', id: 'id', name: 'name' }
}));

vi.mock('$lib/server/db/schema/directory', () => ({
	directoryEntry: { __table: 'directory_entry', id: 'id', groupId: 'group_id' }
}));

// The real one, so the `event_group` write this job now owes goes through the
// same helper `createGroupEvent` and `importBandEvents` use rather than a copy.
vi.mock('$lib/server/event/event-service', async () => {
	const { db } = await import('$lib/server/db');
	const { eventGroup } = await import('$lib/server/db/schema/event');
	return {
		linkManagingGroup: async (links: { eventId: string; groupId: string }[]) => {
			await (db as unknown as { insert: (t: unknown) => { values: (v: unknown) => unknown } })
				.insert(eventGroup)
				.values(links.map((l) => ({ ...l, sortOrder: 0 })));
		}
	};
});

const mockCopyObject = vi.fn();

vi.mock('$lib/server/storage', () => ({
	copyObject: (...args: unknown[]) => mockCopyObject(...args)
}));

const mockAttachExisting = vi.fn();

vi.mock('$lib/server/media/media-service', () => ({
	attachExisting: (...args: unknown[]) => mockAttachExisting(...args)
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

/**
 * Which table each insert went to, so a test can tell an `event` row from the
 * `event_group` link the same write now owes. `insertedRows` keeps its old
 * meaning — everything, in order — because the existing assertions index into
 * it, and a CMC prototype still produces exactly one row.
 */
let insertedByTable: { table: string; row: unknown }[] = [];

function insertTableName(table: unknown): string {
	return (table as { __table?: string } | null)?.__table ?? 'unknown';
}

function setupInsert() {
	insertedByTable = [];
	dbMock.insert.mockImplementation((table: unknown) => ({
		values: vi.fn().mockImplementation((row: unknown) => {
			const rows = Array.isArray(row) ? row : [row];
			for (const r of rows) {
				insertedRows.push(r);
				insertedByTable.push({ table: insertTableName(table), row: r });
			}
			// Thenable *and* chainable: `linkManagingGroup` ends in
			// `.onConflictDoNothing()`, while the event insert is awaited directly.
			const chain = {
				onConflictDoNothing: () => chain,
				then: (resolve: (v: unknown) => void) => resolve(undefined)
			};
			return chain;
		})
	}));
}

function insertsFor(table: string) {
	return insertedByTable.filter((i) => i.table === table).map((i) => i.row);
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

/**
 * A club's recurring jam. Everything the old generator threw away is here:
 * a non-CMC source, an owning group, and a location.
 */
const GROUP_PROTO = {
	...{
		id: 'eproto-2',
		title: 'Monthly Jam',
		description: 'Bring a horn',
		startsAt: new Date('2026-05-13T17:00:00Z'),
		endsAt: new Date('2026-05-13T19:00:00Z'),
		doorsAt: null,
		tags: null,
		ticketingEnabled: false,
		ticketPrice: null,
		ticketQuantity: null,
		createdByUserId: 'user-1',
		reservationId: 'eres-proto'
	},
	source: 'group' as const,
	groupId: 'club-1',
	location: 'Practice Room'
};

/** A band series, which owes a lineup credit where a program's session does not. */
const BAND_PROTO = { ...GROUP_PROTO, id: 'eproto-3', source: 'band' as const, groupId: 'band-1' };

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

	/**
	 * The payoff the media layer was built for. This used to copy the R2 binary
	 * per occurrence — a 52-week series was 52 copies of one JPEG — because
	 * deleting or re-postering one event deleted the object outright, so a shared
	 * key would have been pulled out from under its siblings. Nothing in a request
	 * path deletes an object any more, so the occurrences share one.
	 */
	it('shares the prototype poster instead of copying the object', async () => {
		const protoWithPoster = {
			...EVENT_PROTO,
			reservationId: null,
			posterKey: 'events/posters/eproto-1.webp'
		};
		queueSelects([EVENT_SERIES], [protoWithPoster], [OWNER], []);
		setupInsert();
		setupUpdate();
		mockGetOccurrences.mockReturnValue([OCC1]);
		mockAttachExisting.mockResolvedValue('attachment-1');

		await generateRecurringEvents();

		expect(mockCopyObject).not.toHaveBeenCalled();
		// One more attachment on the same object, in the occurrence's poster slot.
		expect(mockAttachExisting).toHaveBeenCalledWith(
			'event',
			expect.any(String),
			'poster',
			'events/posters/eproto-1.webp'
		);
		// And the column points at the prototype's key, not a new one.
		expect(updatedRows[0]).toMatchObject({ posterKey: 'events/posters/eproto-1.webp' });
	});

	it('still shares the key when the prototype poster was never recorded', async () => {
		// A key with no `media` row means something wrote a poster without
		// recording it. Losing the poster would be an immediate regression, while
		// a missing attachment is a latent one the sweep surfaces, so the key is
		// shared either way and the anomaly is reported.
		const protoWithPoster = {
			...EVENT_PROTO,
			reservationId: null,
			posterKey: 'events/posters/eproto-1.webp'
		};
		queueSelects([EVENT_SERIES], [protoWithPoster], [OWNER], []);
		setupInsert();
		setupUpdate();
		mockGetOccurrences.mockReturnValue([OCC1]);
		mockAttachExisting.mockResolvedValue(null);

		await generateRecurringEvents();

		expect(updatedRows[0]).toMatchObject({ posterKey: 'events/posters/eproto-1.webp' });
	});
});

/**
 * What phase 9 fixed. `processEventSeries` hard-coded `source: 'cmc'` and
 * `status: 'draft'` and copied neither the owner nor the location — latent only
 * because nothing but a staff CMC event could be a prototype. The moment a
 * club's jam can be one, the old shape generates CMC-attributed drafts that
 * reach nobody and hold no room, week after week, unattended.
 */
describe('generateRecurringEvents — a prototype that is not a CMC event', () => {
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

	it("inherits the prototype's source, owner and location", async () => {
		queueSelects([EVENT_SERIES], [GROUP_PROTO], [OWNER], [EVENT_PROTO_RES], []);
		setupInsert();
		setupUpdate();
		mockGetOccurrences.mockReturnValue([OCC1]);

		await generateRecurringEvents();

		expect(insertsFor('event')[0]).toMatchObject({
			source: 'group',
			groupId: 'club-1',
			location: 'Practice Room'
		});
	});

	/**
	 * The decision the spec makes rather than defers. A program's recurring
	 * session sitting in draft is a session its members are never told about;
	 * a CMC series keeps its staff review step, which already exists.
	 */
	it('publishes a program session, and still drafts a CMC one', async () => {
		queueSelects([EVENT_SERIES], [GROUP_PROTO], [OWNER], [EVENT_PROTO_RES], []);
		setupInsert();
		setupUpdate();
		mockGetOccurrences.mockReturnValue([OCC1]);

		await generateRecurringEvents();

		const [occurrence] = insertsFor('event') as Record<string, unknown>[];
		expect(occurrence.status).toBe('published');
		expect(occurrence.publishedAt).toBeInstanceOf(Date);
	});

	it('leaves a CMC series generating drafts for review', async () => {
		queueSelects([EVENT_SERIES], [EVENT_PROTO], [OWNER], [EVENT_PROTO_RES], []);
		setupInsert();
		setupUpdate();
		mockGetOccurrences.mockReturnValue([OCC1]);

		await generateRecurringEvents();

		const [occurrence] = insertsFor('event') as Record<string, unknown>[];
		expect(occurrence.status).toBe('draft');
		expect(occurrence.publishedAt).toBeNull();
	});

	it('gives each occurrence its own event_group row', async () => {
		queueSelects([EVENT_SERIES], [GROUP_PROTO], [OWNER], [EVENT_PROTO_RES], []);
		setupInsert();
		setupUpdate();
		mockGetOccurrences.mockReturnValue([OCC1]);

		await generateRecurringEvents();

		expect(insertsFor('event_group')).toEqual([
			{ eventId: expect.any(String), groupId: 'club-1', sortOrder: 0 }
		]);
	});

	/** A program's session has no bill; a band's gig heads its own. */
	it('writes no lineup credit for a program session', async () => {
		queueSelects([EVENT_SERIES], [GROUP_PROTO], [OWNER], [EVENT_PROTO_RES], []);
		setupInsert();
		setupUpdate();
		mockGetOccurrences.mockReturnValue([OCC1]);

		await generateRecurringEvents();

		expect(insertsFor('event_band')).toHaveLength(0);
	});

	it('writes the owner credit for a band occurrence', async () => {
		queueSelects(
			[EVENT_SERIES],
			[BAND_PROTO],
			[OWNER],
			[EVENT_PROTO_RES],
			[], // existing instances
			[{ name: 'The Squares' }], // the owning band's name, looked up once per series
			[{ id: 'entry-band-1' }] // and its directory entry, which the credit names
		);
		setupInsert();
		setupUpdate();
		mockGetOccurrences.mockReturnValue([OCC1]);

		await generateRecurringEvents();

		// Copying `groupId` is what makes this owed: before phase 9 the generator
		// forced a CMC event with no owner, so the invariant could not be broken
		// here. It can now, which is why it is maintained here.
		expect(insertsFor('event_band')[0]).toMatchObject({
			// The entry, not the group — a credit names a party as of phase 10.
			directoryEntryId: 'entry-band-1',
			addedByGroupId: 'band-1',
			name: 'The Squares',
			billingOrder: 0,
			status: 'confirmed'
		});
	});
});
