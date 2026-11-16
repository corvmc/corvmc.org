import { describe, it, expect, vi, beforeEach } from 'vitest';

// The generator's conflict, dedup and ownership checks are WHERE clauses, so it
// runs against a real SQLite. The occurrence list and the window are fixed
// (rrule-helpers is mocked) so no answer depends on today's date; booking the
// space, ticket terms and media stay mocked as the calls this job makes.

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});
vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const mockSaveTicketSale = vi.fn();
vi.mock('#lib/server/ticket/ticket-sale.js', () => ({ saveTicketSale: mockSaveTicketSale }));

const mockAttachExisting = vi.fn();
vi.mock('#lib/server/media/media-service.js', () => ({
	attachExisting: (...args: unknown[]) => mockAttachExisting(...args)
}));

const mockStaffCreate = vi.fn();
const mockHasConflict = vi.fn();
const mockAnnounceConfirmed = vi.fn();
vi.mock('./reservation-service', () => ({
	staffCreate: (...args: unknown[]) => mockStaffCreate(...args),
	announceConfirmed: (...args: unknown[]) => mockAnnounceConfirmed(...args)
}));
vi.mock('./conflict-service', () => ({
	hasConflict: (...args: unknown[]) => mockHasConflict(...args)
}));

vi.mock('#lib/server/sentry.js', () => ({ captureException: vi.fn() }));

const mockGetOccurrences = vi.fn();
const mockGenerationWindowEnd = vi.fn();
vi.mock('./rrule-helpers', () => ({
	getOccurrences: (...args: unknown[]) => mockGetOccurrences(...args),
	generationWindowEnd: (...args: unknown[]) => mockGenerationWindowEnd(...args)
}));

// Mocked so a regression that opens a production per occurrence is caught (#2009).
const mockCreateShowProject = vi.fn().mockResolvedValue(undefined);
vi.mock('#lib/server/production/production-project.js', () => ({
	createShowProject: (...args: unknown[]) => mockCreateShowProject(...args),
	stampProductionTemplate: vi.fn().mockResolvedValue(undefined)
}));

const mockEmit = vi.fn().mockResolvedValue(undefined);
vi.mock('#lib/server/event-bus/event-bus.js', () => ({
	domainEvents: { emit: (...args: unknown[]) => mockEmit(...args) }
}));

const { generateRecurringReservations, generateRecurringEvents } = await import('./generation-job');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const secs = (d: Date) => Math.floor(d.getTime() / 1000);
const HOUR = 60 * 60 * 1000;

const OCC1 = new Date('2026-05-20T17:00:00Z'); // occurrence start
const OCC1_END = new Date('2026-05-20T19:00:00Z'); // +2h
const PROTO_START = new Date('2026-05-13T17:00:00Z');
const PROTO_END = new Date('2026-05-13T19:00:00Z');

function member(id: string, opts: { deleted?: boolean } = {}) {
	sqlite
		.prepare(`insert into user (id, name, email, deleted_at) values (?, ?, ?, ?)`)
		.run(id, 'Alice Smith', 'alice@example.com', opts.deleted ? 1_746_000_000 : null);
}

function booking(
	id: string,
	startsAt: Date,
	endsAt: Date,
	opts: { status?: string; hardHold?: boolean; seriesId?: string | null; notes?: string } = {}
) {
	sqlite
		.prepare(
			`insert into reservation (id, booker_type, booker_id, created_by_user_id, status, starts_at, ends_at, hard_hold, recurring_series_id, notes)
			 values (?, 'user', 'user-1', 'user-1', ?, ?, ?, ?, ?, ?)`
		)
		.run(
			id,
			opts.status ?? 'confirmed',
			secs(startsAt),
			secs(endsAt),
			opts.hardHold ? 1 : 0,
			opts.seriesId ?? null,
			opts.notes ?? null
		);
}

function series(id: string, prototypeId: string, type = 'reservation') {
	sqlite
		.prepare(
			`insert into recurring_series (id, prototype_type, prototype_id, rrule, created_by) values (?, ?, ?, '{}', 'user-1')`
		)
		.run(id, type, prototypeId);
}

/** A reservation series with its prototype, owned by user-1. */
function reservationSeries(id = 'series-1', protoId = 'proto-1') {
	booking(protoId, PROTO_START, PROTO_END, { seriesId: id, notes: 'Weekly practice' });
	series(id, protoId);
}

const generated = (seriesId = 'series-1') =>
	sqlite
		.prepare(
			`select booker_type as bookerType, booker_id as bookerId, created_by_user_id as createdByUserId,
			        status, starts_at as startsAt, ends_at as endsAt, notes
			 from reservation where recurring_series_id = ? and id not like 'proto-%' order by starts_at`
		)
		.all(seriesId);

beforeEach(() => {
	vi.resetAllMocks();
	mockEmit.mockResolvedValue(undefined);
	mockGenerationWindowEnd.mockReturnValue(new Date('2026-06-20T00:00:00Z'));
	mockGetOccurrences.mockReturnValue([OCC1]);
	mockStaffCreate.mockResolvedValue({ id: 'eres-new' });
	mockHasConflict.mockResolvedValue(false);
	for (const t of [
		'recurring_series',
		'reservation',
		'closure',
		'event_listing',
		'event_group',
		'event_band',
		'ticket_sale',
		'media_attachment',
		'media',
		'directory_entry',
		'group',
		'user'
	]) {
		sqlite.exec(`delete from "${t}"`);
	}
	member('user-1');
});

// ---------------------------------------------------------------------------
// Reservations
// ---------------------------------------------------------------------------

describe('generateRecurringReservations', () => {
	it('returns zeros when no active series exist', async () => {
		booking('proto-1', PROTO_START, PROTO_END);
		series('cancelled', 'proto-1');
		sqlite.exec(`update recurring_series set cancelled_at = 1746000000`);

		expect(await generateRecurringReservations()).toEqual({
			seriesProcessed: 0,
			instancesCreated: 0,
			instancesWaitlisted: 0,
			instancesSkipped: 0,
			errors: []
		});
	});

	// Offboarding cancels the reservations that exist and never stopped the
	// generator, so a removed member's series went on holding the room. #811.
	it('generates nothing for a series whose member has been removed', async () => {
		sqlite.exec(`update user set deleted_at = 1746000000 where id = 'user-1'`);
		reservationSeries();

		const result = await generateRecurringReservations();

		expect(result).toMatchObject({ instancesCreated: 0, instancesWaitlisted: 0 });
		expect(generated()).toEqual([]);
	});

	it('creates reservation instances for occurrences with no conflicts', async () => {
		reservationSeries();

		const result = await generateRecurringReservations();

		expect(result).toMatchObject({
			seriesProcessed: 1,
			instancesCreated: 1,
			instancesSkipped: 0,
			errors: []
		});
		expect(generated()).toEqual([
			{
				bookerType: 'user',
				bookerId: 'user-1',
				createdByUserId: 'user-1',
				status: 'confirmed',
				startsAt: secs(OCC1),
				endsAt: secs(OCC1_END),
				notes: 'Weekly practice'
			}
		]);
		// Confirmed the moment it exists, so announced exactly once (#2502).
		expect(mockAnnounceConfirmed).toHaveBeenCalledTimes(1);
	});

	it('skips occurrences that already exist (dedup)', async () => {
		reservationSeries();
		booking('existing', OCC1, OCC1_END, { seriesId: 'series-1' });

		const result = await generateRecurringReservations();

		expect(result).toMatchObject({ instancesCreated: 0, instancesSkipped: 0 });
		expect(generated()).toHaveLength(1);
	});

	// Rows generated before the daylight-saving fix (#2105) sit an hour off
	// their rule. The same club day is the same occurrence, so no second booking.
	it('treats an instance on the same club day as existing, even an hour off', async () => {
		reservationSeries();
		booking('existing', new Date(OCC1.getTime() - HOUR), new Date(OCC1_END.getTime() - HOUR), {
			seriesId: 'series-1'
		});

		expect((await generateRecurringReservations()).instancesCreated).toBe(0);
		expect(generated()).toHaveLength(1);
	});

	it('does not treat another series’ instance as this one’s', async () => {
		reservationSeries();
		booking('elsewhere', new Date('2026-05-20T08:00:00Z'), new Date('2026-05-20T09:00:00Z'), {
			seriesId: 'series-other'
		});

		expect((await generateRecurringReservations()).instancesCreated).toBe(1);
	});

	/**
	 * The predicate, not how the row was created: moving the hard block off
	 * `hard_hold` would fail in silence — holds just stop blocking, and a
	 * member's booking takes a show's room.
	 */
	it('skips an occurrence on a hard hold and emits recurring_skipped', async () => {
		reservationSeries();
		booking('show-hold', OCC1, OCC1_END, { hardHold: true });

		const result = await generateRecurringReservations();

		expect(result).toMatchObject({ instancesCreated: 0, instancesSkipped: 1 });
		expect(generated()).toEqual([]);
		expect(mockEmit).toHaveBeenCalledOnce();
		expect(mockEmit).toHaveBeenCalledWith(
			'reservation.recurring_skipped',
			expect.objectContaining({
				seriesId: 'series-1',
				userId: 'user-1',
				userName: 'Alice Smith',
				userEmail: 'alice@example.com',
				reason: 'Scheduled event'
			})
		);
	});

	it.each(['cancelled', 'waitlisted'])('is not blocked by a %s hard hold', async (status) => {
		reservationSeries();
		booking('show-hold', OCC1, OCC1_END, { hardHold: true, status });

		expect((await generateRecurringReservations()).instancesCreated).toBe(1);
	});

	it('skips occurrences with closure conflicts', async () => {
		reservationSeries();
		sqlite
			.prepare(
				`insert into closure (id, reason, starts_at, ends_at) values ('c1', 'Holiday closure', ?, ?)`
			)
			.run(secs(OCC1) + 1800, secs(OCC1_END) + 3600);

		const result = await generateRecurringReservations();

		expect(result).toMatchObject({ instancesCreated: 0, instancesSkipped: 1 });
		expect(mockEmit).toHaveBeenCalledWith(
			'reservation.recurring_skipped',
			expect.objectContaining({ reason: 'Holiday closure' })
		);
	});

	it('catches per-series errors without stopping other series', async () => {
		series('series-1', 'proto-missing');
		reservationSeries('series-2', 'proto-2');

		const result = await generateRecurringReservations();

		expect(result).toMatchObject({ seriesProcessed: 1, instancesCreated: 1 });
		expect(result.errors).toEqual(['Series series-1: Prototype reservation not found']);
		expect(generated('series-2')).toHaveLength(1);
		expect(mockEmit).not.toHaveBeenCalled();
	});

	it('creates waitlisted instances when a regular reservation conflicts', async () => {
		reservationSeries();
		booking('someone-else', new Date(OCC1.getTime() + HOUR), new Date(OCC1_END.getTime() + HOUR));

		const result = await generateRecurringReservations();

		expect(result).toMatchObject({
			instancesCreated: 0,
			instancesWaitlisted: 1,
			instancesSkipped: 0,
			errors: []
		});
		expect(generated()).toEqual([expect.objectContaining({ status: 'waitlisted' })]);
		expect(mockEmit).toHaveBeenCalledWith(
			'reservation.recurring_waitlisted',
			expect.objectContaining({ seriesId: 'series-1', reason: 'Time slot is currently booked' })
		);
	});
});

// ---------------------------------------------------------------------------
// Event generation
// ---------------------------------------------------------------------------

interface ProtoOpts {
	source?: string;
	kind?: string;
	groupId?: string | null;
	location?: string | null;
	reservation?: boolean;
	ticketed?: boolean;
	posterKey?: string;
}

/** A prototype event, its series, and (by default) its room booking 30m either side. */
function eventSeries(opts: ProtoOpts = {}) {
	const reserve = opts.reservation ?? true;
	if (reserve) {
		booking(
			'eres-proto',
			new Date(PROTO_START.getTime() - HOUR / 2),
			new Date(PROTO_END.getTime() + HOUR / 2)
		);
	}
	sqlite
		.prepare(
			`insert into event_listing (id, title, description, starts_at, ends_at, doors_at, tags, source, kind, group_id, location, status, created_by_user_id, reservation_id)
			 values ('eproto-1', 'Weekly Open Mic', 'Sign up at the door', ?, ?, ?, 'open mic', ?, ?, ?, ?, 'published', 'user-1', ?)`
		)
		.run(
			secs(PROTO_START),
			secs(PROTO_END),
			secs(PROTO_START) - 1800,
			opts.source ?? 'cmc',
			opts.kind ?? 'show',
			opts.groupId ?? null,
			opts.location ?? null,
			reserve ? 'eres-proto' : null
		);
	if (opts.ticketed ?? true) {
		sqlite.exec(
			`insert into ticket_sale (id, event_listing_id, enabled, price_cents, price_floor_cents, quantity)
			 values ('ts-1', 'eproto-1', 1, 1000, 1000, 40)`
		);
	}
	if (opts.posterKey) {
		sqlite
			.prepare(
				`insert into media (id, key, content_type, byte_size) values ('m1', ?, 'image/webp', 1)`
			)
			.run(opts.posterKey);
		sqlite.exec(
			`insert into media_attachment (id, media_id, attachable_type, attachable_id, slot)
			 values ('ma1', 'm1', 'event_listing', 'eproto-1', 'poster')`
		);
	}
	series('eseries-1', 'eproto-1', 'event_listing');
}

function groupRow(id: string, kind: string, name = 'The Squares') {
	sqlite
		.prepare(`insert into "group" (id, name, slug, kind) values (?, ?, ?, ?)`)
		.run(id, name, id, kind);
}

const occurrences = () =>
	sqlite
		.prepare(
			`select id, title, description, starts_at as startsAt, ends_at as endsAt, doors_at as doorsAt,
			        source, group_id as groupId, location, status, published_at as publishedAt,
			        project_id as projectId, reservation_id as reservationId
			 from event_listing where recurring_series_id = 'eseries-1'`
		)
		.all() as Record<string, unknown>[];

describe('generateRecurringEvents', () => {
	it('creates a draft event and books space for an unconflicted occurrence', async () => {
		eventSeries();

		const result = await generateRecurringEvents();

		expect(result).toMatchObject({
			seriesProcessed: 1,
			instancesCreated: 1,
			instancesSkipped: 0,
			errors: []
		});
		// An occurrence never opens a production; staff attach one by hand (#2009).
		const [occ] = occurrences();
		expect(mockCreateShowProject).not.toHaveBeenCalled();
		expect(occ).toMatchObject({
			title: 'Weekly Open Mic',
			description: 'Sign up at the door',
			startsAt: secs(OCC1),
			endsAt: secs(OCC1_END),
			doorsAt: secs(OCC1) - 1800,
			source: 'cmc',
			status: 'draft',
			projectId: null,
			// The event is linked to the new reservation.
			reservationId: 'eres-new'
		});
		// The night is sold on the series' terms, written to `ticket_sale`.
		expect(mockSaveTicketSale).toHaveBeenCalledWith(occ.id, {
			enabled: true,
			priceCents: 1000,
			priceFloorCents: 1000,
			quantity: 40
		});
		// Space reserved for this occurrence (30m lead/tail preserved).
		expect(mockHasConflict).toHaveBeenCalledOnce();
		expect(mockStaffCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				// No production and no group: the listing holds the room itself.
				bookerType: 'event_listing',
				bookerId: occ.id,
				// A show holds the room outright, and says so on the row.
				hardHold: true,
				// Event-booked space is staff-held, not an uncommitted member booking.
				status: 'confirmed',
				startsAt: new Date(OCC1.getTime() - HOUR / 2),
				endsAt: new Date(OCC1_END.getTime() + HOUR / 2)
			})
		);
	});

	it("books a group's show occurrence to the group, with no production (#2009)", async () => {
		groupRow('club-1', 'club');
		eventSeries({ source: 'group', groupId: 'club-1' });

		await generateRecurringEvents();

		expect(mockCreateShowProject).not.toHaveBeenCalled();
		expect(occurrences()[0].projectId).toBeNull();
		expect(mockStaffCreate).toHaveBeenCalledWith(
			expect.objectContaining({ bookerType: 'group', bookerId: 'club-1' })
		);
	});

	it('still creates the draft event but skips reservation when the slot conflicts', async () => {
		eventSeries();
		mockHasConflict.mockResolvedValue(true);

		const result = await generateRecurringEvents();

		expect(result).toMatchObject({ instancesCreated: 1, instancesSkipped: 1 });
		expect(occurrences()).toEqual([expect.objectContaining({ reservationId: null })]);
		expect(mockStaffCreate).not.toHaveBeenCalled();
		expect(mockEmit).toHaveBeenCalledWith(
			'event.recurring_reservation_skipped',
			expect.objectContaining({
				seriesId: 'eseries-1',
				eventTitle: 'Weekly Open Mic',
				userId: 'user-1'
			})
		);
	});

	it('skips occurrences that already exist (idempotent)', async () => {
		eventSeries();
		await generateRecurringEvents();
		vi.clearAllMocks();

		const result = await generateRecurringEvents();

		expect(result.instancesCreated).toBe(0);
		expect(occurrences()).toHaveLength(1);
		expect(mockStaffCreate).not.toHaveBeenCalled();
	});

	it('does not book space when the prototype has no reservation', async () => {
		eventSeries({ reservation: false });

		const result = await generateRecurringEvents();

		expect(result).toMatchObject({ instancesCreated: 1, instancesSkipped: 0 });
		expect(mockHasConflict).not.toHaveBeenCalled();
		expect(mockStaffCreate).not.toHaveBeenCalled();
	});

	/**
	 * The payoff the media layer was built for: occurrences share the prototype's
	 * one poster object rather than each copying the R2 binary.
	 */
	it.each<{ attached: string | null; label: string }>([
		{
			attached: 'attachment-1',
			label: 'shares the prototype poster instead of copying the object'
		},
		// A key with no `media` row: the key is shared anyway and the anomaly reported.
		{ attached: null, label: 'still shares the key when the prototype poster was never recorded' }
	])('$label', async ({ attached }) => {
		eventSeries({ reservation: false, posterKey: 'events/posters/eproto-1.webp' });
		mockAttachExisting.mockResolvedValue(attached);

		await generateRecurringEvents();

		expect(mockAttachExisting).toHaveBeenCalledWith(
			'event_listing',
			occurrences()[0].id,
			'poster',
			'events/posters/eproto-1.webp'
		);
	});
});

/**
 * What phase 9 fixed: the generator hard-coded `source: 'cmc'` and `draft` and
 * copied neither the owner nor the location, so a club's jam as a prototype
 * would generate CMC-attributed drafts that reach nobody, week after week.
 */
describe('generateRecurringEvents — a prototype that is not a CMC event', () => {
	const programSeries = () => {
		groupRow('club-1', 'club');
		eventSeries({ source: 'group', groupId: 'club-1', location: 'Practice Room', ticketed: false });
	};

	it("inherits the prototype's source, owner and location", async () => {
		programSeries();

		await generateRecurringEvents();

		expect(occurrences()[0]).toMatchObject({
			source: 'group',
			groupId: 'club-1',
			location: 'Practice Room'
		});
	});

	/** A program's session in draft is one its members are never told about. */
	it('publishes a program session, and still drafts a CMC one', async () => {
		programSeries();

		await generateRecurringEvents();

		expect(occurrences()[0]).toMatchObject({
			status: 'published',
			publishedAt: expect.any(Number)
		});
	});

	it('leaves a CMC series generating drafts for review', async () => {
		eventSeries();

		await generateRecurringEvents();

		expect(occurrences()[0]).toMatchObject({ status: 'draft', publishedAt: null });
	});

	it('gives each occurrence its own event_group row, and no lineup credit', async () => {
		programSeries();

		await generateRecurringEvents();

		const [occ] = occurrences();
		expect(sqlite.prepare('select event_id, group_id, sort_order from event_group').all()).toEqual([
			{ event_id: occ.id, group_id: 'club-1', sort_order: 0 }
		]);
		// A program's session has no bill; a band's gig heads its own.
		expect(sqlite.prepare('select count(*) as n from event_band').get()).toEqual({ n: 0 });
	});

	/** #714. A band prototype here would hold the free room every week. */
	it('generates nothing for a band-owned program series', async () => {
		groupRow('band-1', 'band');
		eventSeries({ source: 'group', groupId: 'band-1' });

		const result = await generateRecurringEvents();

		expect(occurrences()).toEqual([]);
		expect(mockStaffCreate).not.toHaveBeenCalled();
		// Recorded rather than swallowed.
		expect(result.seriesProcessed).toBe(0);
		expect(result.errors).toEqual(['Series eseries-1: Group not found']);
	});

	it('writes the owner credit for a band occurrence', async () => {
		groupRow('band-1', 'band', 'The Squares');
		groupRow('band-2', 'band', 'Not Them');
		sqlite.exec(
			`insert into directory_entry (id, group_id, name) values ('entry-band-2', 'band-2', 'Not Them'), ('entry-band-1', 'band-1', 'The Squares')`
		);
		eventSeries({ source: 'band', groupId: 'band-1' });

		await generateRecurringEvents();

		// The entry, not the group — a credit names a party as of phase 10.
		expect(
			sqlite
				.prepare(
					`select directory_entry_id as directoryEntryId, added_by_group_id as addedByGroupId,
					        name, billing_order as billingOrder, status from event_band`
				)
				.all()
		).toEqual([
			{
				directoryEntryId: 'entry-band-1',
				addedByGroupId: 'band-1',
				name: 'The Squares',
				billingOrder: 0,
				status: 'confirmed'
			}
		]);
	});
});
