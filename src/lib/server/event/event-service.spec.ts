import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockEventRow = {
	id: 'evt-1',
	title: 'Open Mic Night',
	description: 'Come play!',
	startsAt: new Date('2025-07-15T02:00:00Z'),
	endsAt: new Date('2025-07-15T05:00:00Z'),
	doorsAt: null,
	status: 'draft',
	publishedAt: null,
	reservationId: null,
	posterKey: null,
	tags: 'open mic,music',
	ticketingEnabled: false,
	ticketPrice: null,
	ticketQuantity: null,
	// The column default, and the only source CMC sells tickets for. Left
	// implicit before the community layer existed, when the ticketing guard
	// tested for 'band' rather than not-'cmc'.
	source: 'cmc',
	bandId: null,
	location: null,
	externalTicketUrl: null,
	reviewNotes: null,
	createdByUserId: 'staff-1',
	createdAt: new Date(),
	updatedAt: new Date()
};

// Track what the mock DB does
let selectResult: unknown[] = [];
let selectResultQueue: unknown[][] = [];
let updateRowCount = 1;

function chainable(result?: unknown[]) {
	const proxy: PromiseLike<unknown[]> = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				return (resolve: (v: unknown[]) => void) => {
					if (result !== undefined) return resolve(result);
					if (selectResultQueue.length > 0) return resolve(selectResultQueue.shift()!);
					return resolve(selectResult);
				};
			}
			if (prop === 'meta') return { changes: updateRowCount };
			return () => proxy;
		}
	}) as unknown as PromiseLike<unknown[]>;
	return proxy;
}

let lastInsertedValues: Record<string, unknown> | null = null;
let lastUpdateSet: Record<string, unknown> | null = null;

// When set, the next db.insert(...).returning() rejects — used to exercise the
// compensating-delete path in create().
let insertShouldThrow = false;

const insertValues = vi.fn((vals: Record<string, unknown>) => {
	lastInsertedValues = vals;
	return {
		returning: vi.fn(() =>
			insertShouldThrow
				? Promise.reject(new Error('insert failed'))
				: Promise.resolve([{ ...mockEventRow, ...vals }])
		)
	};
});
const eventInsert = vi.fn(() => ({ values: insertValues }));

const deleteWhere = vi.fn(() => Promise.resolve());
const eventDelete = vi.fn(() => ({ where: deleteWhere }));

vi.mock('$lib/server/db', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/db')>();
	return {
		...actual,
		db: {
			select: () => chainable(),
			// Referenced lazily — the factory is evaluated during the hoisted
			// import, before these module-level consts initialize.
			insert: (...args: unknown[]) => eventInsert(...(args as [])),
			delete: (...args: unknown[]) => eventDelete(...(args as [])),
			update: vi.fn(() => ({
				set: vi.fn((vals: Record<string, unknown>) => {
					lastUpdateSet = vals;
					return {
						where: vi.fn(() => ({
							returning: vi.fn(() => Promise.resolve([{ ...mockEventRow, ...vals }])),
							then: (resolve: (v: unknown) => void) =>
								resolve({ meta: { changes: updateRowCount } })
						}))
					};
				})
			}))
		}
	};
});

vi.mock('$lib/server/reservation/reservation-service', () => ({
	staffCreate: vi.fn().mockResolvedValue({ id: 'res-1' }),
	cancel: vi.fn().mockResolvedValue(undefined),
	ReservationConflictError: class extends Error {
		constructor() {
			super('Time slot is not available');
		}
	}
}));

vi.mock('$lib/server/reservation/conflict-service', () => ({
	hasConflict: vi.fn().mockResolvedValue(false)
}));

const mockEmit = vi.fn().mockResolvedValue(undefined);
vi.mock('$lib/server/events/event-bus', () => ({
	domainEvents: { emit: (...args: unknown[]) => mockEmit(...args) }
}));

vi.mock('$lib/server/storage', () => ({
	uploadFile: vi.fn().mockResolvedValue('events/posters/evt-1.jpg'),
	deleteObject: vi.fn().mockResolvedValue(undefined),
	// Returns the destination key on success, null when the source is gone —
	// the real contract in storage.ts.
	copyObject: vi.fn((_src: string, dest: string) => Promise.resolve(dest))
}));

const mockTicketsSold = vi.fn().mockResolvedValue(0);
vi.mock('$lib/server/ticket/ticket-service', () => ({
	getTicketsSold: (...args: unknown[]) => mockTicketsSold(...args)
}));

import {
	create,
	publish,
	cancel,
	update,
	checkRebookNeeded,
	unpublishWithNotice,
	listPublicUpcomingEvents,
	remove
} from './event-service';
import {
	staffCreate,
	cancel as cancelReservation
} from '$lib/server/reservation/reservation-service';
import { hasConflict } from '$lib/server/reservation/conflict-service';
import { uploadFile, deleteObject, copyObject } from '$lib/server/storage';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';

describe('EventService', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		selectResult = [];
		selectResultQueue = [];
		updateRowCount = 1;
		lastInsertedValues = null;
		lastUpdateSet = null;
		insertShouldThrow = false;
	});

	// -----------------------------------------------------------------------
	// create
	// -----------------------------------------------------------------------

	describe('create', () => {
		const baseParams = {
			title: 'Open Mic Night',
			description: 'Come play!',
			startsAt: new Date('2025-07-15T02:00:00Z'),
			endsAt: new Date('2025-07-15T05:00:00Z'),
			tags: 'open mic,music',
			createdByUserId: 'staff-1'
		};

		it('creates an event without reservation or poster', async () => {
			const result = await create(baseParams);

			// The event id is generated client-side (D1 has no interactive txn to
			// read back a server default mid-flow) and used for the insert.
			expect(result.id).toBe(lastInsertedValues!.id);
			expect(eventInsert).toHaveBeenCalled();
			expect(lastInsertedValues!.reservationId).toBeNull();
			expect(staffCreate).not.toHaveBeenCalled();
			expect(uploadFile).not.toHaveBeenCalled();
		});

		it('creates linked reservation when reservation params provided', async () => {
			await create({
				...baseParams,
				reservation: {
					startsAt: new Date('2025-07-15T01:00:00Z'),
					endsAt: new Date('2025-07-15T06:00:00Z'),
					overrideConflicts: false
				}
			});

			expect(hasConflict).toHaveBeenCalled();
			// Reservation is created first, booked against the generated event id,
			// then the event is inserted already linked to it.
			expect(staffCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					bookerType: 'event',
					bookerId: lastInsertedValues!.id,
					status: 'confirmed'
				})
			);
			expect(lastInsertedValues!.reservationId).toBe('res-1');
		});

		it('deletes the orphan reservation when the event insert fails', async () => {
			insertShouldThrow = true;

			await expect(
				create({
					...baseParams,
					reservation: {
						startsAt: new Date('2025-07-15T01:00:00Z'),
						endsAt: new Date('2025-07-15T06:00:00Z'),
						overrideConflicts: true
					}
				})
			).rejects.toThrow('insert failed');

			// Compensating write: the reservation we created must be removed.
			expect(staffCreate).toHaveBeenCalled();
			expect(eventDelete).toHaveBeenCalled();
			expect(deleteWhere).toHaveBeenCalled();
		});

		it('does not attempt compensation when there is no reservation', async () => {
			insertShouldThrow = true;

			await expect(create(baseParams)).rejects.toThrow('insert failed');

			expect(staffCreate).not.toHaveBeenCalled();
			expect(eventDelete).not.toHaveBeenCalled();
		});

		it('skips conflict check when overrideConflicts is true', async () => {
			await create({
				...baseParams,
				reservation: {
					startsAt: new Date('2025-07-15T01:00:00Z'),
					endsAt: new Date('2025-07-15T06:00:00Z'),
					overrideConflicts: true
				}
			});

			expect(hasConflict).not.toHaveBeenCalled();
			expect(staffCreate).toHaveBeenCalled();
		});

		it('throws when conflict exists and override is false', async () => {
			vi.mocked(hasConflict).mockResolvedValueOnce(true);

			await expect(
				create({
					...baseParams,
					reservation: {
						startsAt: new Date('2025-07-15T01:00:00Z'),
						endsAt: new Date('2025-07-15T06:00:00Z'),
						overrideConflicts: false
					}
				})
			).rejects.toThrow('Time slot is not available');
		});

		it('uploads poster when posterFile provided', async () => {
			const posterBuffer = new ArrayBuffer(1024);

			const result = await create({
				...baseParams,
				posterFile: { buffer: posterBuffer, contentType: 'image/jpeg' }
			});

			expect(uploadFile).toHaveBeenCalledWith(
				posterBuffer,
				expect.stringMatching(new RegExp(`^events/posters/${result.id}-[0-9a-f]{8}\\.jpg$`)),
				'image/jpeg'
			);
		});

		it('stores ticketing fields when ticketing is enabled', async () => {
			await create({
				...baseParams,
				ticketingEnabled: true,
				ticketPrice: 1500,
				ticketQuantity: 50
			});

			expect(lastInsertedValues).toMatchObject({
				ticketingEnabled: true,
				ticketPrice: 1500,
				ticketQuantity: 50
			});
		});

		it('stores null price and quantity when ticketing is disabled and neither is given', async () => {
			await create(baseParams);

			expect(lastInsertedValues).toMatchObject({
				ticketingEnabled: false,
				ticketPrice: null,
				ticketQuantity: null
			});
		});

		// The price is what an attendee pays, wherever they buy — an off-site
		// seller or the door. Only capacity is ours to enforce, so only capacity
		// is tied to platform ticketing.
		it('keeps a display price when ticketing is disabled', async () => {
			await create({
				...baseParams,
				ticketingEnabled: false,
				ticketPrice: 1800,
				ticketQuantity: 50
			});

			expect(lastInsertedValues).toMatchObject({
				ticketingEnabled: false,
				ticketPrice: 1800,
				ticketQuantity: null
			});
		});

		it('rejects a zero or negative display price', async () => {
			await expect(
				create({ ...baseParams, ticketingEnabled: false, ticketPrice: 0 })
			).rejects.toThrow('Ticket price must be a positive amount');
		});

		it('throws when ticketing is enabled but price is missing', async () => {
			await expect(create({ ...baseParams, ticketingEnabled: true })).rejects.toThrow(
				'Ticket price is required'
			);
		});

		it('throws when ticketing is enabled but price is zero', async () => {
			await expect(
				create({ ...baseParams, ticketingEnabled: true, ticketPrice: 0 })
			).rejects.toThrow('Ticket price is required');
		});

		it('allows null ticketQuantity for unlimited capacity', async () => {
			await create({
				...baseParams,
				ticketingEnabled: true,
				ticketPrice: 1000
			});

			expect(lastInsertedValues).toMatchObject({
				ticketingEnabled: true,
				ticketPrice: 1000,
				ticketQuantity: null
			});
		});
	});

	// -----------------------------------------------------------------------
	// publish
	// -----------------------------------------------------------------------

	describe('publish', () => {
		it('publishes a draft event', async () => {
			updateRowCount = 1;
			await expect(publish('evt-1')).resolves.toBeUndefined();
		});

		it('throws when event is not in draft status', async () => {
			updateRowCount = 0;
			selectResult = [{ ...mockEventRow, status: 'published' }];

			await expect(publish('evt-1')).rejects.toThrow('Cannot publish');
		});

		it('throws when event does not exist', async () => {
			updateRowCount = 0;
			selectResult = [];

			await expect(publish('evt-999')).rejects.toThrow('Event not found');
		});
	});

	// -----------------------------------------------------------------------
	// cancel
	// -----------------------------------------------------------------------

	describe('cancel', () => {
		it('cancels an event without reservation', async () => {
			selectResult = [{ ...mockEventRow, status: 'draft' }];

			await cancel('evt-1', 'staff-1');

			expect(cancelReservation).not.toHaveBeenCalled();
			expect(deleteObject).not.toHaveBeenCalled();
		});

		it('cancels linked reservation when present', async () => {
			selectResult = [{ ...mockEventRow, status: 'published', reservationId: 'res-1' }];

			await cancel('evt-1', 'staff-1');

			expect(cancelReservation).toHaveBeenCalledWith('res-1', 'staff-1', 'Event cancelled', {
				staffOverride: true
			});
		});

		it('deletes poster from R2 when present', async () => {
			selectResult = [{ ...mockEventRow, status: 'draft', posterKey: 'events/posters/evt-1.jpg' }];

			await cancel('evt-1', 'staff-1');

			expect(deleteObject).toHaveBeenCalledWith('events/posters/evt-1.jpg');
		});

		it('throws when event is already cancelled', async () => {
			selectResult = [{ ...mockEventRow, status: 'cancelled' }];

			await expect(cancel('evt-1', 'staff-1')).rejects.toThrow('already cancelled');
		});

		it('ignores error if linked reservation is already cancelled', async () => {
			selectResult = [{ ...mockEventRow, status: 'published', reservationId: 'res-1' }];
			vi.mocked(cancelReservation).mockRejectedValueOnce(new Error('Cannot cancel'));

			// Should not throw — error from cancelReservation is caught
			await expect(cancel('evt-1', 'staff-1')).resolves.toBeUndefined();
		});

		it('voids live tickets and notifies holders without promising automatic refunds', async () => {
			const holder = { attendeeName: 'Ana', attendeeEmail: 'ana@example.com', userId: 'u-1' };
			selectResultQueue = [
				[{ ...mockEventRow, status: 'published' }], // getById
				[holder] // ticket holders (valid/pending)
			];

			await cancel('evt-1', 'staff-1');

			// The last update is the ticket sweep: valid/pending → cancelled.
			expect(lastUpdateSet?.status).toBe('cancelled');

			// Flush the fire-and-forget notification.
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(mockEmit).toHaveBeenCalledWith(
				'event.cancelled',
				expect.objectContaining({
					eventId: 'evt-1',
					ticketHolders: [{ attendeeName: 'Ana', attendeeEmail: 'ana@example.com', userId: 'u-1' }],
					refundNote: expect.not.stringContaining('automatically')
				})
			);
		});

		it('emits event.cancelled with no ticket holders when nothing was sold', async () => {
			selectResultQueue = [
				[{ ...mockEventRow, status: 'published' }], // getById
				[] // ticket holders — none
			];

			await cancel('evt-1', 'staff-1');

			// Flush the fire-and-forget notification.
			await new Promise((resolve) => setTimeout(resolve, 0));

			const cancelledEmits = mockEmit.mock.calls.filter(([name]) => name === 'event.cancelled');
			expect(cancelledEmits).toHaveLength(1);
			expect(cancelledEmits[0][1]).toMatchObject({
				eventId: 'evt-1',
				eventTitle: 'Open Mic Night',
				ticketHolders: []
			});
		});
	});

	// -----------------------------------------------------------------------
	// checkRebookNeeded
	// -----------------------------------------------------------------------

	describe('checkRebookNeeded', () => {
		const resRow = {
			id: 'res-1',
			startsAt: new Date('2025-07-15T01:00:00Z'),
			endsAt: new Date('2025-07-15T06:00:00Z')
		};

		it('returns not needed when event has no reservation', async () => {
			// getById returns event with no reservationId
			selectResult = [{ ...mockEventRow, reservationId: null }];

			const result = await checkRebookNeeded(
				'evt-1',
				new Date('2025-07-15T02:00:00Z'),
				new Date('2025-07-15T05:00:00Z')
			);

			expect(result.needed).toBe(false);
			expect(result.currentReservation).toBeNull();
		});

		it('returns not needed when new times fit within reservation', async () => {
			// First select: getById (event), second select: reservation row
			selectResultQueue = [[{ ...mockEventRow, reservationId: 'res-1' }], [resRow]];

			const result = await checkRebookNeeded(
				'evt-1',
				new Date('2025-07-15T02:00:00Z'), // within 01:00-06:00
				new Date('2025-07-15T05:00:00Z')
			);

			expect(result.needed).toBe(false);
		});

		it('returns needed when event starts earlier than reservation', async () => {
			selectResultQueue = [[{ ...mockEventRow, reservationId: 'res-1' }], [resRow]];

			const result = await checkRebookNeeded(
				'evt-1',
				new Date('2025-07-15T00:30:00Z'), // before 01:00
				new Date('2025-07-15T05:00:00Z')
			);

			expect(result.needed).toBe(true);
			expect(result.reason).toContain('starts earlier');
		});

		it('returns needed when event ends later than reservation', async () => {
			selectResultQueue = [[{ ...mockEventRow, reservationId: 'res-1' }], [resRow]];

			const result = await checkRebookNeeded(
				'evt-1',
				new Date('2025-07-15T02:00:00Z'),
				new Date('2025-07-15T07:00:00Z') // after 06:00
			);

			expect(result.needed).toBe(true);
			expect(result.reason).toContain('ends later');
		});

		it('returns needed with both reasons when extending both directions', async () => {
			selectResultQueue = [[{ ...mockEventRow, reservationId: 'res-1' }], [resRow]];

			const result = await checkRebookNeeded(
				'evt-1',
				new Date('2025-07-15T00:00:00Z'),
				new Date('2025-07-15T08:00:00Z')
			);

			expect(result.needed).toBe(true);
			expect(result.reason).toContain('starts earlier');
			expect(result.reason).toContain('ends later');
		});

		it('returns not needed when times match exactly', async () => {
			selectResultQueue = [[{ ...mockEventRow, reservationId: 'res-1' }], [resRow]];

			const result = await checkRebookNeeded(
				'evt-1',
				new Date('2025-07-15T01:00:00Z'),
				new Date('2025-07-15T06:00:00Z')
			);

			expect(result.needed).toBe(false);
		});
	});

	// -----------------------------------------------------------------------
	// update with rebook
	// -----------------------------------------------------------------------

	describe('update with rebook', () => {
		it('cancels old reservation and creates new one', async () => {
			// getById for the update call
			selectResult = [{ ...mockEventRow, status: 'published', reservationId: 'res-1' }];

			await update('evt-1', {
				startsAt: new Date('2025-07-15T00:00:00Z'),
				endsAt: new Date('2025-07-15T07:00:00Z'),
				rebook: {
					userId: 'staff-1',
					reservationStartsAt: new Date('2025-07-15T00:00:00Z'),
					reservationEndsAt: new Date('2025-07-15T07:00:00Z'),
					overrideConflicts: false
				}
			});

			expect(cancelReservation).toHaveBeenCalledWith(
				'res-1',
				'staff-1',
				'Event times changed — rebooking',
				{ staffOverride: true }
			);
			expect(staffCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					bookerType: 'event',
					bookerId: 'evt-1',
					status: 'confirmed' // event-booked space is staff-held, never member-confirmed
				})
			);
		});

		// A draft event's space is held the same way a published one's is. Booking
		// it as `scheduled` made it look like an uncommitted member booking, and
		// publish() never confirms it, so the unconfirmed sweep released the room.
		it('creates a confirmed reservation for draft events too', async () => {
			selectResult = [{ ...mockEventRow, status: 'draft', reservationId: 'res-1' }];

			await update('evt-1', {
				rebook: {
					userId: 'staff-1',
					reservationStartsAt: new Date('2025-07-15T00:00:00Z'),
					reservationEndsAt: new Date('2025-07-15T07:00:00Z'),
					overrideConflicts: true
				}
			});

			expect(staffCreate).toHaveBeenCalledWith(expect.objectContaining({ status: 'confirmed' }));
		});

		it('throws on conflict when override is false', async () => {
			selectResult = [{ ...mockEventRow, status: 'published', reservationId: 'res-1' }];
			vi.mocked(hasConflict).mockResolvedValueOnce(true);

			await expect(
				update('evt-1', {
					rebook: {
						userId: 'staff-1',
						reservationStartsAt: new Date('2025-07-15T00:00:00Z'),
						reservationEndsAt: new Date('2025-07-15T07:00:00Z'),
						overrideConflicts: false
					}
				})
			).rejects.toThrow('Time slot is not available');
		});

		it('skips conflict check when override is true', async () => {
			selectResult = [{ ...mockEventRow, status: 'published', reservationId: 'res-1' }];

			await update('evt-1', {
				rebook: {
					userId: 'staff-1',
					reservationStartsAt: new Date('2025-07-15T00:00:00Z'),
					reservationEndsAt: new Date('2025-07-15T07:00:00Z'),
					overrideConflicts: true
				}
			});

			expect(hasConflict).not.toHaveBeenCalled();
			expect(staffCreate).toHaveBeenCalled();
		});

		// This used to assert the opposite — that an event without a reservation was
		// left alone. That silence was the bug: an event created without a hold had
		// no way to acquire one, so a calendar of reservation-less events piled up
		// with nothing in the app able to repair them.
		it('books the space for an event that has none', async () => {
			selectResult = [{ ...mockEventRow, status: 'published', reservationId: null }];

			await update('evt-1', {
				title: 'New Title',
				rebook: {
					userId: 'staff-1',
					reservationStartsAt: new Date('2025-07-15T00:00:00Z'),
					reservationEndsAt: new Date('2025-07-15T07:00:00Z'),
					overrideConflicts: false
				}
			});

			// Nothing to release — this is an add, not a replace.
			expect(cancelReservation).not.toHaveBeenCalled();
			expect(staffCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					bookerType: 'event',
					bookerId: 'evt-1',
					status: 'confirmed'
				})
			);
			expect(lastUpdateSet?.reservationId).toBe('res-1');
		});

		// The conflict check used to run *after* the cancellation, so a rejected
		// window released the room and left the event pointing at a cancelled
		// reservation, with nothing re-created and no compensating write.
		it('leaves the existing hold intact when the new window conflicts', async () => {
			selectResult = [{ ...mockEventRow, status: 'published', reservationId: 'res-1' }];
			vi.mocked(hasConflict).mockResolvedValueOnce(true);

			await expect(
				update('evt-1', {
					rebook: {
						userId: 'staff-1',
						reservationStartsAt: new Date('2025-07-15T00:00:00Z'),
						reservationEndsAt: new Date('2025-07-15T07:00:00Z'),
						overrideConflicts: false
					}
				})
			).rejects.toThrow('Time slot is not available');

			expect(cancelReservation).not.toHaveBeenCalled();
			expect(staffCreate).not.toHaveBeenCalled();
		});

		// An event must not collide with its own hold when it is only being re-timed.
		it('excludes the event current reservation from the conflict check', async () => {
			selectResult = [{ ...mockEventRow, status: 'published', reservationId: 'res-1' }];

			await update('evt-1', {
				rebook: {
					userId: 'staff-1',
					reservationStartsAt: new Date('2025-07-15T00:00:00Z'),
					reservationEndsAt: new Date('2025-07-15T07:00:00Z'),
					overrideConflicts: false
				}
			});

			expect(hasConflict).toHaveBeenCalledWith(expect.any(Date), expect.any(Date), 'res-1');
		});
	});

	// -----------------------------------------------------------------------
	// update ticketing fields
	// -----------------------------------------------------------------------

	describe('unpublishWithNotice', () => {
		const publishedBandEvent = {
			id: 'evt-1',
			title: 'Loud Show',
			status: 'published',
			source: 'band',
			bandId: 'band-1',
			bandName: 'The Squares'
		};

		it('unpublishes a band event and notifies its admins', async () => {
			selectResultQueue = [
				[publishedBandEvent], // event + band lookup
				[{ ...mockEventRow, status: 'published' }], // getById inside unpublish()
				[{ bandId: 'band-1' }], // confirmed lineup
				[{ id: 'u9', name: 'Admin', email: 'admin@example.com' }] // band admins
			];

			await unpublishWithNotice('evt-1', { notes: 'Poster violated guidelines' });

			expect(lastUpdateSet).toMatchObject({ status: 'draft', publishedAt: null });
			await Promise.resolve();
			await Promise.resolve();
			expect(mockEmit).toHaveBeenCalledWith(
				'event.unpublished_by_staff',
				expect.objectContaining({
					eventId: 'evt-1',
					eventTitle: 'Loud Show',
					bandId: 'band-1',
					bandName: 'The Squares',
					notes: 'Poster violated guidelines',
					bandAdmins: [{ userId: 'u9', userName: 'Admin', userEmail: 'admin@example.com' }]
				})
			);
		});

		it('notifies every confirmed band on the bill, not just the owner', async () => {
			selectResultQueue = [
				[publishedBandEvent],
				[{ ...mockEventRow, status: 'published' }],
				// A two-band bill: the owner plus a confirmed support act.
				[{ bandId: 'band-1' }, { bandId: 'band-2' }],
				[
					{ id: 'u9', name: 'Admin', email: 'admin@example.com' },
					{ id: 'u10', name: 'Support Admin', email: 'support@example.com' }
				]
			];

			await unpublishWithNotice('evt-1');

			await Promise.resolve();
			await Promise.resolve();
			expect(mockEmit).toHaveBeenCalledWith(
				'event.unpublished_by_staff',
				expect.objectContaining({
					bandAdmins: [
						{ userId: 'u9', userName: 'Admin', userEmail: 'admin@example.com' },
						{ userId: 'u10', userName: 'Support Admin', userEmail: 'support@example.com' }
					]
				})
			);
		});

		it('is a no-op when the event is already off the guide', async () => {
			selectResultQueue = [[{ ...publishedBandEvent, status: 'draft' }]];

			await unpublishWithNotice('evt-1');

			expect(lastUpdateSet).toBeNull();
			await Promise.resolve();
			expect(mockEmit).not.toHaveBeenCalled();
		});

		it('notifies nobody for a CMC event', async () => {
			selectResultQueue = [
				[{ ...publishedBandEvent, source: 'cmc', bandId: null, bandName: null }],
				[{ ...mockEventRow, status: 'published' }]
			];

			await unpublishWithNotice('evt-1');

			expect(lastUpdateSet).toMatchObject({ status: 'draft' });
			await Promise.resolve();
			await Promise.resolve();
			expect(mockEmit).not.toHaveBeenCalled();
		});

		// -------------------------------------------------------------------
		// Community listings
		// -------------------------------------------------------------------
		//
		// Posters are served straight from R2 at a guessable key, and that URL
		// consults nothing — not status, not source. So for a community listing
		// this path has to destroy the object, not just drop the row off the
		// guide: it is the advertised kill switch, and an image is the riskiest
		// thing on the page.

		const publishedCommunityListing = {
			id: 'evt-1',
			title: 'Basement show',
			status: 'published',
			source: 'community',
			bandId: null,
			bandName: null,
			posterKey: 'events/posters/evt-1.jpg',
			createdByUserId: 'member-1'
		};

		// The poster used to be deleted outright here. It has to stop being
		// reachable at its guessable public key — that was the point — but a
		// takedown is a moderation decision, not a reason to destroy the member's
		// artwork. Rotating the key satisfies the first without the second.
		it('rotates a community listing’s poster to an unguessable key instead of deleting it', async () => {
			selectResultQueue = [
				[publishedCommunityListing],
				[{ ...mockEventRow, status: 'published' }],
				[{ name: 'Ada', email: 'ada@example.com' }]
			];

			await unpublishWithNotice('evt-1', { notes: 'No venue given' });

			const withheldKey = expect.stringMatching(
				/^events\/posters\/withheld\/evt-1-[0-9a-f-]{36}\.jpg$/
			);
			expect(copyObject).toHaveBeenCalledWith('events/posters/evt-1.jpg', withheldKey);
			// The guessable key is what goes away.
			expect(deleteObject).toHaveBeenCalledWith('events/posters/evt-1.jpg');
			expect(lastUpdateSet).toMatchObject({
				posterKey: withheldKey,
				reviewNotes: 'No venue given'
			});
		});

		it('nulls posterKey only when the object is already gone', async () => {
			vi.mocked(copyObject).mockResolvedValueOnce(null);
			selectResultQueue = [
				[publishedCommunityListing],
				[{ ...mockEventRow, status: 'published' }],
				[{ name: 'Ada', email: 'ada@example.com' }]
			];

			await unpublishWithNotice('evt-1', { notes: 'No venue given' });

			// Nothing to preserve, so don't leave the row pointing at a dead key.
			expect(deleteObject).not.toHaveBeenCalled();
			expect(lastUpdateSet).toMatchObject({ posterKey: null });
		});

		// Same principle one column over: a takedown with no note used to write
		// `reviewNotes: null`, wiping whatever reason was already on the row.
		it('leaves an existing reviewNotes alone when no note is given', async () => {
			selectResultQueue = [
				[publishedCommunityListing],
				[{ ...mockEventRow, status: 'published' }],
				[{ name: 'Ada', email: 'ada@example.com' }]
			];

			await unpublishWithNotice('evt-1');

			expect(lastUpdateSet).not.toHaveProperty('reviewNotes');
		});

		it('notifies the member who posted it, with the staff note', async () => {
			selectResultQueue = [
				[publishedCommunityListing],
				[{ ...mockEventRow, status: 'published' }],
				[{ name: 'Ada', email: 'ada@example.com' }]
			];

			await unpublishWithNotice('evt-1', { notes: 'No venue given' });

			await Promise.resolve();
			await Promise.resolve();
			expect(mockEmit).toHaveBeenCalledWith(
				'community_event.unpublished',
				expect.objectContaining({
					eventId: 'evt-1',
					submitterUserId: 'member-1',
					submitterEmail: 'ada@example.com',
					notes: 'No venue given'
				})
			);
		});

		it('leaves a band gig’s artwork alone — that takedown is reversible', async () => {
			selectResultQueue = [
				[{ ...publishedBandEvent, posterKey: 'events/posters/evt-1.jpg' }],
				[{ ...mockEventRow, status: 'published' }],
				[{ bandId: 'band-1' }],
				[{ id: 'u9', name: 'Admin', email: 'admin@example.com' }]
			];

			await unpublishWithNotice('evt-1');

			expect(deleteObject).not.toHaveBeenCalled();
		});
	});

	// -----------------------------------------------------------------------
	// remove()
	// -----------------------------------------------------------------------
	//
	// Deleting is for a row that should never have existed. The FKs alone get
	// four things wrong, and each of these pins one of them.

	describe('remove', () => {
		const deletableEvent = {
			...mockEventRow,
			status: 'draft',
			reservationId: 'res-1',
			posterKey: 'events/posters/evt-1.jpg'
		};

		it('refuses once any ticket exists, and says to cancel instead', async () => {
			selectResultQueue = [
				[deletableEvent], // getById
				[{ value: 2 }] // ticket count
			];

			// One call, both assertions: the select queue drains, so re-invoking
			// would be asserting against an empty fixture rather than this case.
			const err = await remove('evt-1', 'staff-1').catch((e: Error) => e);

			expect(err).toBeInstanceOf(Error);
			expect((err as Error).message).toMatch(/tickets/i);
			// The sentence has to point somewhere useful, not just refuse.
			expect((err as Error).message).toMatch(/[Cc]ancel/);
		});

		it('does not delete anything when it refuses', async () => {
			selectResultQueue = [[deletableEvent], [{ value: 1 }]];

			await expect(remove('evt-1', 'staff-1')).rejects.toThrow();

			expect(eventDelete).not.toHaveBeenCalled();
			expect(deleteObject).not.toHaveBeenCalled();
			expect(cancelReservation).not.toHaveBeenCalled();
		});

		it('refuses a ticket in any status, not just live ones', async () => {
			// Cancelled tickets are still payment records. `cancel()` voids tickets
			// rather than removing them, so a cancelled ticketed event must not
			// become deletable afterwards.
			selectResultQueue = [[{ ...deletableEvent, status: 'cancelled' }], [{ value: 3 }]];

			await expect(remove('evt-1', 'staff-1')).rejects.toThrow(/tickets/i);
		});

		it('cancels the linked reservation rather than deleting it', async () => {
			selectResultQueue = [[deletableEvent], [{ value: 0 }]];

			await remove('evt-1', 'staff-1');

			// Deleting the reservation would leave the room booked (no onDelete rule
			// on event.reservationId), and for a recurring instance the generation
			// job — which dedupes on reservation rows, not events — would quietly
			// recreate the event on its next run.
			expect(cancelReservation).toHaveBeenCalledWith('res-1', 'staff-1', 'Event deleted', {
				staffOverride: true
			});
		});

		it('takes the poster with it', async () => {
			selectResultQueue = [[deletableEvent], [{ value: 0 }]];

			await remove('evt-1', 'staff-1');

			// Nothing about the R2 URL consults the database, so an orphaned object
			// stays world-readable forever.
			expect(deleteObject).toHaveBeenCalledWith('events/posters/evt-1.jpg');
		});

		it('deletes the row, and the flags that would dangle', async () => {
			selectResultQueue = [[deletableEvent], [{ value: 0 }]];

			await remove('evt-1', 'staff-1');

			// content_flag is polymorphic with no FK — a surviving report would
			// point at nothing and break the triage queue.
			expect(eventDelete).toHaveBeenCalledTimes(2);
		});

		it('survives a reservation that was already cancelled', async () => {
			selectResultQueue = [[deletableEvent], [{ value: 0 }]];
			vi.mocked(cancelReservation).mockRejectedValueOnce(new Error('Already cancelled'));

			await expect(remove('evt-1', 'staff-1')).resolves.toBeUndefined();
			expect(eventDelete).toHaveBeenCalled();
		});

		it('throws when the event does not exist', async () => {
			selectResultQueue = [[]];

			await expect(remove('evt-1', 'staff-1')).rejects.toThrow('Event not found');
			expect(eventDelete).not.toHaveBeenCalled();
		});
	});

	// -----------------------------------------------------------------------
	// Public visibility
	// -----------------------------------------------------------------------
	//
	// This is the line between "announced" and "never public". A cancelled show
	// belongs on the guide — the cancellation IS the announcement, and the
	// people who need it are the ones who already had the date. A `rejected`
	// listing is its exact opposite and must never reach these queries.

	describe('public queries', () => {
		it('selects published and cancelled, and nothing else', async () => {
			const { publicEventStatuses } = await import('$lib/server/db/schema/event');

			expect([...publicEventStatuses]).toEqual(['published', 'cancelled']);
			expect(publicEventStatuses).not.toContain('rejected');
			expect(publicEventStatuses).not.toContain('draft');
			expect(publicEventStatuses).not.toContain('pending_review');
		});

		it('binds those two statuses into listPublicUpcomingEvents', async () => {
			selectResult = [];
			await listPublicUpcomingEvents(new Date('2026-01-01'), { limit: 20, offset: 0 });

			// The chainable proxy erases the call shape, so assert on the SQL the
			// filter renders to instead.
			const { inArray } = await import('drizzle-orm');
			const { event, publicEventStatuses } = await import('$lib/server/db/schema/event');
			const { params } = new SQLiteSyncDialect().sqlToQuery(
				inArray(event.status, [...publicEventStatuses])
			);
			expect(params).toEqual(['published', 'cancelled']);
		});
	});

	// CMC only sells shows CMC produces: the money would otherwise land in CMC's
	// Stripe account with no payout path back to whoever is putting the show on.
	// Neither `createBandEvent` nor `createCommunityEvent` takes ticketing
	// params, so `update()` is the only remaining way a non-CMC row could
	// acquire `ticketingEnabled` — these pin that shut.
	describe('only CMC events can be ticketed', () => {
		const bandEvent = { ...mockEventRow, status: 'draft', source: 'band', bandId: 'band-1' };
		const communityListing = { ...mockEventRow, status: 'draft', source: 'community' };

		it('rejects enabling ticketing on a band event', async () => {
			selectResult = [bandEvent];

			await expect(update('evt-1', { ticketingEnabled: true, ticketPrice: 2000 })).rejects.toThrow(
				'CMC only sells tickets for its own events'
			);
		});

		it('rejects enabling ticketing on a community listing', async () => {
			selectResult = [communityListing];

			await expect(update('evt-1', { ticketingEnabled: true, ticketPrice: 2000 })).rejects.toThrow(
				'CMC only sells tickets for its own events'
			);
		});

		it('allows a door price on a community listing', async () => {
			selectResult = [communityListing];

			await update('evt-1', { ticketPrice: 2000 });

			expect(lastUpdateSet).toMatchObject({ ticketPrice: 2000 });
			expect(lastUpdateSet).not.toHaveProperty('ticketingEnabled');
		});

		it('allows a door price on a band event', async () => {
			// Only our checkout is off limits. `ticketPrice` is a display price for
			// the door or an outside seller, and the band forms let bands set one.
			selectResult = [bandEvent];

			await update('evt-1', { ticketPrice: 2000 });

			expect(lastUpdateSet).toMatchObject({ ticketPrice: 2000 });
			expect(lastUpdateSet).not.toHaveProperty('ticketingEnabled');
		});

		it('allows an external ticket link on a band event', async () => {
			selectResult = [bandEvent];

			await update('evt-1', { externalTicketUrl: 'https://venue.test/tickets' });

			expect(lastUpdateSet).toMatchObject({
				externalTicketUrl: 'https://venue.test/tickets'
			});
		});

		it('still allows disabling ticketing on a band event', async () => {
			// The escape hatch for a row written before the rule existed: staff
			// opening the edit form submits `false` and clears the stale flag. The
			// price stays — turning our checkout off doesn't make the show free.
			selectResult = [{ ...bandEvent, ticketingEnabled: true, ticketPrice: 2000 }];

			await update('evt-1', { ticketingEnabled: false });

			expect(lastUpdateSet).toMatchObject({
				ticketingEnabled: false,
				ticketQuantity: null
			});
		});

		it('leaves non-ticketing edits to a band event alone', async () => {
			selectResult = [bandEvent];

			await update('evt-1', { title: 'New Title', location: 'The Whiteside' });

			expect(lastUpdateSet).toMatchObject({ title: 'New Title', location: 'The Whiteside' });
		});

		it('does not restrict ticketing on a CMC event', async () => {
			selectResult = [{ ...mockEventRow, status: 'draft', source: 'cmc' }];

			await update('evt-1', { ticketingEnabled: true, ticketPrice: 2000 });

			expect(lastUpdateSet).toMatchObject({ ticketingEnabled: true, ticketPrice: 2000 });
		});
	});

	describe('update ticketing fields', () => {
		it('enables ticketing with price and quantity', async () => {
			selectResult = [{ ...mockEventRow, status: 'draft' }];

			await update('evt-1', {
				ticketingEnabled: true,
				ticketPrice: 2000,
				ticketQuantity: 100
			});

			expect(lastUpdateSet).toMatchObject({
				ticketingEnabled: true,
				ticketPrice: 2000,
				ticketQuantity: 100
			});
		});

		// Turning off our checkout doesn't make the show free — the price stays as
		// the door / off-site price. Capacity is meaningless once we stop counting.
		it('clears quantity but keeps the price when disabling ticketing', async () => {
			selectResult = [
				{
					...mockEventRow,
					status: 'draft',
					ticketingEnabled: true,
					ticketPrice: 2000,
					ticketQuantity: 100
				}
			];

			await update('evt-1', {
				ticketingEnabled: false
			});

			expect(lastUpdateSet).toMatchObject({
				ticketingEnabled: false,
				ticketQuantity: null
			});
			expect(lastUpdateSet).not.toHaveProperty('ticketPrice');
		});

		it('sets a display price alongside disabling ticketing', async () => {
			selectResult = [
				{
					...mockEventRow,
					status: 'draft',
					ticketingEnabled: true,
					ticketPrice: 2000,
					ticketQuantity: 100
				}
			];

			await update('evt-1', { ticketingEnabled: false, ticketPrice: 1800 });

			expect(lastUpdateSet).toMatchObject({
				ticketingEnabled: false,
				ticketPrice: 1800,
				ticketQuantity: null
			});
		});

		it('clears the price when explicitly set to null', async () => {
			selectResult = [
				{ ...mockEventRow, status: 'draft', ticketingEnabled: true, ticketPrice: 2000 }
			];

			await update('evt-1', { ticketingEnabled: false, ticketPrice: null });

			expect(lastUpdateSet).toMatchObject({ ticketingEnabled: false, ticketPrice: null });
		});

		it('throws when enabling ticketing without price', async () => {
			selectResult = [{ ...mockEventRow, status: 'draft' }];

			await expect(update('evt-1', { ticketingEnabled: true })).rejects.toThrow(
				'Ticket price is required'
			);
		});

		it('throws when enabling ticketing with zero price', async () => {
			selectResult = [{ ...mockEventRow, status: 'draft' }];

			await expect(update('evt-1', { ticketingEnabled: true, ticketPrice: 0 })).rejects.toThrow(
				'Ticket price must be a positive amount'
			);
		});

		it('throws when editing the price to a non-positive value without toggling ticketing', async () => {
			selectResult = [
				{ ...mockEventRow, status: 'draft', ticketingEnabled: true, ticketPrice: 1500 }
			];

			await expect(update('evt-1', { ticketPrice: -100 })).rejects.toThrow(
				'Ticket price must be a positive amount'
			);
			await expect(update('evt-1', { ticketPrice: NaN })).rejects.toThrow(
				'Ticket price must be a positive amount'
			);
		});

		it('updates price independently when ticketingEnabled is not changed', async () => {
			selectResult = [
				{ ...mockEventRow, status: 'draft', ticketingEnabled: true, ticketPrice: 1500 }
			];

			await update('evt-1', { ticketPrice: 2500 });

			expect(lastUpdateSet).toMatchObject({ ticketPrice: 2500 });
			expect(lastUpdateSet).not.toHaveProperty('ticketingEnabled');
		});

		it('rejects update on cancelled event', async () => {
			selectResult = [{ ...mockEventRow, status: 'cancelled' }];

			await expect(update('evt-1', { ticketingEnabled: true, ticketPrice: 1000 })).rejects.toThrow(
				'Cannot update a cancelled event'
			);
		});
	});
});
