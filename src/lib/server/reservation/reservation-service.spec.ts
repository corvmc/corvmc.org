import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock dependencies before importing the module under test
// ---------------------------------------------------------------------------

const { txSelect, txInsert } = vi.hoisted(() => ({
	txSelect: vi.fn(),
	txInsert: vi.fn()
}));

vi.mock('$lib/server/db', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/db')>();
	return {
		...actual,
		db: {
			select: txSelect,
			insert: txInsert,
			update: vi.fn()
		}
	};
});

vi.mock('./conflict-service', () => ({
	validateBooking: vi.fn(),
	hasConflict: vi.fn()
}));

vi.mock('$lib/server/finance/payment-service', () => ({
	refund: vi.fn()
}));

import {
	create,
	cancel,
	cancelUnconfirmedReservations,
	staffCreate,
	adjustWindow,
	confirm,
	markComplete,
	markNoShow,
	recordCashAndComplete,
	autoCompleteExpired,
	ReservationStateError,
	ReservationValidationError,
	ReservationConflictError,
	ReservationNotFoundError,
	ReservationAuthorizationError
} from './reservation-service';
import { validateBooking, hasConflict } from './conflict-service';
import { refund } from '$lib/server/finance/payment-service';
import { db } from '$lib/server/db';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';

// drizzle and the schema are real, so the predicates the service builds can be
// rendered to actual SQL and asserted on rather than taken on faith.
const dialect = new SQLiteSyncDialect();

describe('ReservationService', () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	describe('create', () => {
		const params = {
			userId: 'user-1',
			bookerType: 'user' as const,
			bookerId: 'user-1',
			startsAt: new Date('2025-07-15T17:00:00Z'),
			endsAt: new Date('2025-07-15T19:00:00Z'),
			notes: 'Practice drums'
		};

		it('creates a reservation when validation passes and no conflict', async () => {
			vi.mocked(validateBooking).mockResolvedValue({ valid: true });

			// tx.select for conflict check — no conflicts
			const txWhere = vi.fn().mockResolvedValue([]);
			const txFrom = vi.fn().mockReturnValue({ where: txWhere });
			txSelect.mockReturnValue({ from: txFrom });

			// tx.insert for the new reservation
			const mockRow = { id: 'res-1', ...params, status: 'scheduled', createdByUserId: 'user-1' };
			const returning = vi.fn().mockResolvedValue([mockRow]);
			const values = vi.fn().mockReturnValue({ returning });
			txInsert.mockReturnValue({ values });

			const result = await create(params);

			// The booker type is forwarded, not defaulted: without it a half-hour
			// teaching booking is refused by the member `minDurationHours`, and a
			// term of lessons by the member advance window.
			expect(validateBooking).toHaveBeenCalledWith(params.startsAt, params.endsAt, {
				bookerType: params.bookerType
			});
			expect(result.id).toBe('res-1');
		});

		it('throws ReservationValidationError when time is invalid', async () => {
			vi.mocked(validateBooking).mockResolvedValue({ valid: false, error: 'Too short' });

			await expect(create(params)).rejects.toThrow(ReservationValidationError);
		});

		it('throws ReservationConflictError when slot is taken', async () => {
			vi.mocked(validateBooking).mockResolvedValue({ valid: true });

			// tx.select returns a conflicting row
			const txWhere = vi.fn().mockResolvedValue([{ id: 'existing-res' }]);
			const txFrom = vi.fn().mockReturnValue({ where: txWhere });
			txSelect.mockReturnValue({ from: txFrom });

			await expect(create(params)).rejects.toThrow(ReservationConflictError);
		});
	});

	describe('cancel', () => {
		const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
		const futureEnd = new Date(future.getTime() + 2 * 60 * 60 * 1000);
		const past = new Date(Date.now() - 24 * 60 * 60 * 1000);

		function setupSelectMock(row: Record<string, unknown>) {
			const limit = vi.fn().mockResolvedValue([row]);
			const where = vi.fn().mockReturnValue({ limit });
			const from = vi.fn().mockReturnValue({ where });
			vi.mocked(db.select).mockReturnValue({ from } as any);
		}

		function setupUpdateMock(rowCount: number) {
			const updateWhere = vi.fn().mockResolvedValue({ meta: { changes: rowCount } });
			const set = vi.fn().mockReturnValue({ where: updateWhere });
			vi.mocked(db.update).mockReturnValue({ set } as any);
			return set;
		}

		it('cancels a scheduled reservation without refund', async () => {
			setupSelectMock({
				id: 'res-1',
				createdByUserId: 'user-1',
				status: 'scheduled',
				stripePaymentRecordId: null,
				startsAt: future,
				endsAt: futureEnd
			});
			const set = setupUpdateMock(1);

			await cancel('res-1', 'user-1', 'Changed plans');

			expect(set).toHaveBeenCalledWith(
				expect.objectContaining({ status: 'cancelled', cancellationReason: 'Changed plans' })
			);
			expect(refund).not.toHaveBeenCalled();
		});

		it('cancels a confirmed reservation and triggers refund', async () => {
			setupSelectMock({
				id: 'res-1',
				createdByUserId: 'user-1',
				status: 'confirmed',
				stripePaymentRecordId: 'pr_123',
				startsAt: future,
				endsAt: futureEnd
			});
			setupUpdateMock(1);

			await cancel('res-1', 'user-1');

			expect(refund).toHaveBeenCalledWith({
				userId: 'user-1',
				stripePaymentRecordId: 'pr_123'
			});
		});

		it('rejects cancellation by non-owner', async () => {
			setupSelectMock({
				id: 'res-1',
				createdByUserId: 'user-1',
				status: 'scheduled',
				stripePaymentRecordId: null
			});

			await expect(cancel('res-1', 'user-2')).rejects.toThrow(ReservationAuthorizationError);
		});

		it('rejects cancellation of already-cancelled reservation', async () => {
			setupSelectMock({
				id: 'res-1',
				createdByUserId: 'user-1',
				status: 'cancelled',
				stripePaymentRecordId: null
			});

			await expect(cancel('res-1', 'user-1')).rejects.toThrow(ReservationStateError);
		});

		it('throws ReservationStateError (not a generic 500) for already-cancelled', async () => {
			setupSelectMock({
				id: 'res-1',
				createdByUserId: 'user-1',
				status: 'cancelled',
				stripePaymentRecordId: null
			});

			await expect(cancel('res-1', 'user-1')).rejects.toBeInstanceOf(ReservationStateError);
		});

		it('throws when reservation not found', async () => {
			const limit = vi.fn().mockResolvedValue([]);
			const where = vi.fn().mockReturnValue({ limit });
			const from = vi.fn().mockReturnValue({ where });
			vi.mocked(db.select).mockReturnValue({ from } as any);

			await expect(cancel('res-999', 'user-1')).rejects.toThrow(ReservationNotFoundError);
		});

		it('throws when status changed concurrently', async () => {
			setupSelectMock({
				id: 'res-1',
				createdByUserId: 'user-1',
				status: 'scheduled',
				stripePaymentRecordId: null,
				startsAt: future,
				endsAt: futureEnd
			});
			setupUpdateMock(0);

			await expect(cancel('res-1', 'user-1')).rejects.toThrow(ReservationStateError);
		});

		it('allows staff override even if not owner', async () => {
			setupSelectMock({
				id: 'res-1',
				createdByUserId: 'user-1',
				status: 'scheduled',
				stripePaymentRecordId: null,
				startsAt: past,
				endsAt: new Date(past.getTime() + 2 * 60 * 60 * 1000)
			});
			setupUpdateMock(1);

			await cancel('res-1', 'staff-1', 'Staff cancelled', { staffOverride: true });

			expect(refund).not.toHaveBeenCalled();
		});

		it('rejects cancellation of a past reservation by the owner', async () => {
			setupSelectMock({
				id: 'res-1',
				createdByUserId: 'user-1',
				status: 'confirmed',
				stripePaymentRecordId: null,
				startsAt: past,
				endsAt: new Date(past.getTime() + 2 * 60 * 60 * 1000)
			});
			const set = setupUpdateMock(1);

			await expect(cancel('res-1', 'user-1')).rejects.toThrow(ReservationStateError);
			expect(set).not.toHaveBeenCalled();
		});
	});

	describe('staffCreate', () => {
		function setupInsertMock(row: Record<string, unknown>) {
			const returning = vi.fn().mockResolvedValue([row]);
			const values = vi.fn().mockReturnValue({ returning });
			vi.mocked(db.insert).mockReturnValue({ values } as any);
		}

		it('creates a reservation without validation or conflict check', async () => {
			const mockRow = { id: 'res-1', status: 'confirmed' };
			setupInsertMock(mockRow);

			const result = await staffCreate({
				userId: 'staff-1',
				bookerType: 'user',
				bookerId: 'user-1',
				startsAt: new Date('2025-07-15T17:00:00Z'),
				endsAt: new Date('2025-07-15T19:00:00Z')
			});

			expect(result).toEqual(mockRow);
			expect(validateBooking).not.toHaveBeenCalled();
		});

		it('uses provided status', async () => {
			const mockRow = { id: 'res-2', status: 'scheduled' };
			setupInsertMock(mockRow);

			const result = await staffCreate({
				userId: 'staff-1',
				bookerType: 'user',
				bookerId: 'user-1',
				startsAt: new Date('2025-07-15T17:00:00Z'),
				endsAt: new Date('2025-07-15T19:00:00Z'),
				status: 'scheduled'
			});

			expect(result.status).toBe('scheduled');
		});
	});

	// -----------------------------------------------------------------------
	// adjustWindow — re-time in place, so the door code survives
	// -----------------------------------------------------------------------

	describe('adjustWindow', () => {
		const current = {
			startsAt: new Date('2025-07-15T02:00:00Z'),
			endsAt: new Date('2025-07-15T05:00:00Z')
		};

		/** Queue the rows successive db.select() chains resolve to, in order. */
		function setupSelects(...rows: unknown[][]) {
			const queue = [...rows];
			const limit = vi.fn(() => Promise.resolve(queue.shift() ?? []));
			const where = vi.fn().mockReturnValue({ limit });
			const from = vi.fn().mockReturnValue({ where });
			vi.mocked(db.select).mockReturnValue({ from } as any);
		}

		function setupUpdate(rowCount: number) {
			const updateWhere = vi.fn().mockResolvedValue({ meta: { changes: rowCount } });
			const set = vi.fn().mockReturnValue({ where: updateWhere });
			vi.mocked(db.update).mockReturnValue({ set } as any);
			return { set, updateWhere };
		}

		it('widens the window in place and returns the window it replaced', async () => {
			setupSelects([current]);
			vi.mocked(hasConflict).mockResolvedValue(false);
			const { set } = setupUpdate(1);

			const previous = await adjustWindow(
				'res-1',
				new Date('2025-07-15T01:00:00Z'),
				new Date('2025-07-15T07:00:00Z')
			);

			expect(previous).toEqual({
				previousStartsAt: current.startsAt,
				previousEndsAt: current.endsAt
			});
			expect(set).toHaveBeenCalledWith(
				expect.objectContaining({
					startsAt: new Date('2025-07-15T01:00:00Z'),
					endsAt: new Date('2025-07-15T07:00:00Z')
				})
			);
		});

		// The whole point of the function: cancel-and-recreate dropped these, and
		// the cron that mints a door code has already run by the afternoon.
		it('leaves the status and the door code alone', async () => {
			setupSelects([current]);
			vi.mocked(hasConflict).mockResolvedValue(false);
			const { set } = setupUpdate(1);

			await adjustWindow(
				'res-1',
				new Date('2025-07-15T01:00:00Z'),
				new Date('2025-07-15T07:00:00Z')
			);

			const payload = set.mock.calls[0][0] as Record<string, unknown>;
			expect(payload).not.toHaveProperty('status');
			expect(payload).not.toHaveProperty('lockCode');
		});

		it('only re-times a live booking', async () => {
			setupSelects([current]);
			vi.mocked(hasConflict).mockResolvedValue(false);
			const { updateWhere } = setupUpdate(1);

			await adjustWindow(
				'res-1',
				new Date('2025-07-15T01:00:00Z'),
				new Date('2025-07-15T07:00:00Z')
			);

			const { sql: rendered, params } = dialect.sqlToQuery(updateWhere.mock.calls[0][0] as SQL);
			expect(rendered).toContain('status');
			expect(params).toContain('scheduled');
			expect(params).toContain('confirmed');
			expect(params).not.toContain('cancelled');
		});

		// A booking cannot conflict with the hold it is moving.
		it('excludes the reservation from its own conflict check', async () => {
			setupSelects([current]);
			vi.mocked(hasConflict).mockResolvedValue(false);
			setupUpdate(1);

			await adjustWindow(
				'res-1',
				new Date('2025-07-15T01:00:00Z'),
				new Date('2025-07-15T07:00:00Z')
			);

			expect(hasConflict).toHaveBeenCalledWith(
				new Date('2025-07-15T01:00:00Z'),
				new Date('2025-07-15T07:00:00Z'),
				'res-1'
			);
		});

		it('throws on a conflicting window without writing', async () => {
			setupSelects([current]);
			vi.mocked(hasConflict).mockResolvedValue(true);
			setupUpdate(1);

			await expect(
				adjustWindow('res-1', new Date('2025-07-15T01:00:00Z'), new Date('2025-07-15T07:00:00Z'))
			).rejects.toThrow(ReservationConflictError);

			expect(db.update).not.toHaveBeenCalled();
		});

		it('skips the conflict check when overridden', async () => {
			setupSelects([current]);
			setupUpdate(1);

			await adjustWindow(
				'res-1',
				new Date('2025-07-15T01:00:00Z'),
				new Date('2025-07-15T07:00:00Z'),
				{ overrideConflicts: true }
			);

			expect(hasConflict).not.toHaveBeenCalled();
		});

		it('rejects a window that ends before it starts', async () => {
			await expect(
				adjustWindow('res-1', new Date('2025-07-15T07:00:00Z'), new Date('2025-07-15T01:00:00Z'))
			).rejects.toThrow(ReservationValidationError);
		});

		it('throws when the reservation is gone', async () => {
			setupSelects([]);

			await expect(
				adjustWindow('res-1', new Date('2025-07-15T01:00:00Z'), new Date('2025-07-15T07:00:00Z'))
			).rejects.toThrow(ReservationNotFoundError);
		});

		// Cancelled between the read and the write — the row must not come back.
		it('throws when the status changed under it', async () => {
			setupSelects([current], [{ status: 'cancelled' }]);
			vi.mocked(hasConflict).mockResolvedValue(false);
			setupUpdate(0);

			await expect(
				adjustWindow('res-1', new Date('2025-07-15T01:00:00Z'), new Date('2025-07-15T07:00:00Z'))
			).rejects.toThrow(ReservationStateError);
		});
	});

	describe('confirm', () => {
		function setupUpdateMock(rowCount: number, selectRow?: Record<string, unknown>) {
			const updateWhere = vi.fn().mockResolvedValue({ meta: { changes: rowCount } });
			const set = vi.fn().mockReturnValue({ where: updateWhere });
			vi.mocked(db.update).mockReturnValue({ set } as any);

			if (selectRow !== undefined) {
				const limit = vi.fn().mockResolvedValue([selectRow]);
				const where = vi.fn().mockReturnValue({ limit });
				const from = vi.fn().mockReturnValue({ where });
				vi.mocked(db.select).mockReturnValue({ from } as any);
			}
		}

		it('confirms a scheduled reservation', async () => {
			setupUpdateMock(1);
			await confirm('res-1');
			expect(db.update).toHaveBeenCalled();
		});

		it('throws when reservation not found', async () => {
			setupUpdateMock(0, undefined);
			const limit = vi.fn().mockResolvedValue([]);
			const where = vi.fn().mockReturnValue({ limit });
			const from = vi.fn().mockReturnValue({ where });
			vi.mocked(db.select).mockReturnValue({ from } as any);

			await expect(confirm('res-999')).rejects.toThrow(ReservationNotFoundError);
		});

		it('throws when status is not scheduled', async () => {
			setupUpdateMock(0, { status: 'completed' });

			await expect(confirm('res-1')).rejects.toThrow(ReservationStateError);
		});
	});

	describe('markComplete', () => {
		function setupUpdateMock(rowCount: number, selectRow?: Record<string, unknown>) {
			const updateWhere = vi.fn().mockResolvedValue({ meta: { changes: rowCount } });
			const set = vi.fn().mockReturnValue({ where: updateWhere });
			vi.mocked(db.update).mockReturnValue({ set } as any);

			if (selectRow !== undefined) {
				const limit = vi.fn().mockResolvedValue([selectRow]);
				const where = vi.fn().mockReturnValue({ limit });
				const from = vi.fn().mockReturnValue({ where });
				vi.mocked(db.select).mockReturnValue({ from } as any);
			}
		}

		it('completes a confirmed reservation', async () => {
			setupUpdateMock(1);
			await markComplete('res-1');
			expect(db.update).toHaveBeenCalled();
		});

		it('throws when reservation has wrong status', async () => {
			setupUpdateMock(0, { status: 'scheduled' });

			await expect(markComplete('res-1')).rejects.toThrow(ReservationStateError);
		});
	});

	describe('markNoShow', () => {
		function setupUpdateMock(rowCount: number) {
			const updateWhere = vi.fn().mockResolvedValue({ meta: { changes: rowCount } });
			const set = vi.fn().mockReturnValue({ where: updateWhere });
			vi.mocked(db.update).mockReturnValue({ set } as any);
		}

		it('marks a confirmed reservation as no_show', async () => {
			setupUpdateMock(1);
			await markNoShow('res-1');
			expect(db.update).toHaveBeenCalled();
		});

		it('throws when reservation not found', async () => {
			setupUpdateMock(0);
			const limit = vi.fn().mockResolvedValue([]);
			const where = vi.fn().mockReturnValue({ limit });
			const from = vi.fn().mockReturnValue({ where });
			vi.mocked(db.select).mockReturnValue({ from } as any);

			await expect(markNoShow('res-999')).rejects.toThrow(ReservationNotFoundError);
		});
	});

	describe('recordCashAndComplete', () => {
		function setupUpdateMock(rowCount: number) {
			const updateWhere = vi.fn().mockResolvedValue({ meta: { changes: rowCount } });
			const set = vi.fn().mockReturnValue({ where: updateWhere });
			vi.mocked(db.update).mockReturnValue({ set } as any);
		}

		it('transitions scheduled → completed with payment record', async () => {
			setupUpdateMock(1);
			await recordCashAndComplete('res-1', 'pr_abc');
			expect(db.update).toHaveBeenCalled();
		});

		it('throws when reservation not found', async () => {
			setupUpdateMock(0);
			const limit = vi.fn().mockResolvedValue([]);
			const where = vi.fn().mockReturnValue({ limit });
			const from = vi.fn().mockReturnValue({ where });
			vi.mocked(db.select).mockReturnValue({ from } as any);

			await expect(recordCashAndComplete('res-999', 'pr_abc')).rejects.toThrow(
				ReservationNotFoundError
			);
		});

		it('throws when reservation is in a terminal status', async () => {
			setupUpdateMock(0);
			const limit = vi.fn().mockResolvedValue([{ status: 'completed' }]);
			const where = vi.fn().mockReturnValue({ limit });
			const from = vi.fn().mockReturnValue({ where });
			vi.mocked(db.select).mockReturnValue({ from } as any);

			await expect(recordCashAndComplete('res-1', 'pr_abc')).rejects.toThrow(ReservationStateError);
		});
	});

	describe('cancelUnconfirmedReservations', () => {
		const past = new Date(Date.now() - 60 * 60 * 1000);
		const pastEnd = new Date(past.getTime() + 2 * 60 * 60 * 1000);

		// First db.select is the sweep (returns ids); the rest are cancel()'s internal
		// lookups (return the full row). Mirrors the blanket select used in cancel tests.
		function setupSweep(ids: Array<{ id: string }>, row: Record<string, unknown>) {
			const sweepWhere = vi.fn().mockResolvedValue(ids);
			const sweepFrom = vi.fn().mockReturnValue({ where: sweepWhere });
			const limit = vi.fn().mockResolvedValue([row]);
			const where = vi.fn().mockReturnValue({ limit });
			const from = vi.fn().mockReturnValue({ where });
			vi.mocked(db.select)
				.mockReturnValueOnce({ from: sweepFrom } as any)
				.mockReturnValue({ from } as any);
		}

		function setupUpdateMock(rowCount: number) {
			const updateWhere = vi.fn().mockResolvedValue({ meta: { changes: rowCount } });
			const set = vi.fn().mockReturnValue({ where: updateWhere });
			vi.mocked(db.update).mockReturnValue({ set } as any);
			return set;
		}

		it('cancels a scheduled reservation whose start has passed', async () => {
			setupSweep([{ id: 'res-1' }], {
				id: 'res-1',
				createdByUserId: 'user-1',
				status: 'scheduled',
				stripePaymentRecordId: null,
				startsAt: past,
				endsAt: pastEnd
			});
			const set = setupUpdateMock(1);

			const result = await cancelUnconfirmedReservations(new Date());

			expect(result.cancelled).toBe(1);
			expect(result.errors).toHaveLength(0);
			expect(set).toHaveBeenCalledWith(
				expect.objectContaining({
					status: 'cancelled',
					cancellationReason: 'Not confirmed before start'
				})
			);
			// No payment on a scheduled reservation → no refund.
			expect(refund).not.toHaveBeenCalled();
		});

		it('returns zero when nothing is unconfirmed', async () => {
			const sweepWhere = vi.fn().mockResolvedValue([]);
			const sweepFrom = vi.fn().mockReturnValue({ where: sweepWhere });
			vi.mocked(db.select).mockReturnValue({ from: sweepFrom } as any);

			const result = await cancelUnconfirmedReservations(new Date());

			expect(result.cancelled).toBe(0);
			expect(db.update).not.toHaveBeenCalled();
		});

		it('records an error and continues when a cancel fails', async () => {
			setupSweep([{ id: 'res-1' }], {
				id: 'res-1',
				createdByUserId: 'user-1',
				status: 'scheduled',
				stripePaymentRecordId: null,
				startsAt: past,
				endsAt: pastEnd
			});
			setupUpdateMock(0); // concurrent change → cancel() throws

			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
			const result = await cancelUnconfirmedReservations(new Date());

			expect(result.cancelled).toBe(0);
			expect(result.errors).toHaveLength(1);
			expect(result.errors[0]).toContain('res-1');
			consoleSpy.mockRestore();
		});

		// Regression: space booked for an event is staff-held — there is no member
		// confirm/pay flow for it and publishing an event never touches its
		// reservation. Sweeping it as "unconfirmed" released the room at showtime
		// and cascaded waitlist promotion into a live event.
		it('excludes event-booked space from the sweep', async () => {
			const sweepWhere = vi.fn().mockResolvedValue([]);
			const sweepFrom = vi.fn().mockReturnValue({ where: sweepWhere });
			vi.mocked(db.select).mockReturnValue({ from: sweepFrom } as any);

			await cancelUnconfirmedReservations(new Date());

			const { sql: rendered, params } = dialect.sqlToQuery(sweepWhere.mock.calls[0][0] as SQL);
			expect(rendered).toContain('"booker_type" <>');
			expect(params).toContain('event_listing');
		});
	});

	describe('autoCompleteExpired', () => {
		it('returns the number of rows updated', async () => {
			const updateWhere = vi.fn().mockResolvedValue({ meta: { changes: 3 } });
			const set = vi.fn().mockReturnValue({ where: updateWhere });
			vi.mocked(db.update).mockReturnValue({ set } as any);

			const count = await autoCompleteExpired();
			expect(count).toBe(3);
		});

		it('returns 0 when no expired reservations', async () => {
			const updateWhere = vi.fn().mockResolvedValue({ meta: { changes: 0 } });
			const set = vi.fn().mockReturnValue({ where: updateWhere });
			vi.mocked(db.update).mockReturnValue({ set } as any);

			const count = await autoCompleteExpired();
			expect(count).toBe(0);
		});
	});
});
