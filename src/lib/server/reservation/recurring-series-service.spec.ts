import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock dependencies before importing the module under test
// ---------------------------------------------------------------------------

vi.mock('$lib/server/db', () => ({
	getRowCount: (result: unknown) => {
		const r = result as { meta?: { changes?: number } };
		return r?.meta?.changes ?? 0;
	},
	db: {
		select: vi.fn(),
		insert: vi.fn(),
		update: vi.fn(() => ({
			set: vi.fn(() => ({
				where: vi.fn(() => Promise.resolve({ meta: { changes: 1 } }))
			}))
		})),
		batch: vi.fn()
	}
}));

vi.mock('$lib/server/db/schema/recurring', () => ({
	recurringSeries: { id: 'recurringSeries.id' }
}));

vi.mock('$lib/server/db/schema/reservation', () => ({
	reservation: { id: 'reservation.id' }
}));

vi.mock('$lib/server/db/schema/event', () => ({
	event: { id: 'event.id' }
}));

vi.mock('$lib/server/db/schema/authentication', () => ({
	user: { id: 'user.id' }
}));

vi.mock('drizzle-orm', () => ({
	eq: vi.fn((col, val) => ({ eq: [col, val] })),
	and: vi.fn((...args) => ({ and: args })),
	isNull: vi.fn((col) => ({ isNull: col })),
	inArray: vi.fn((col, vals) => ({ inArray: [col, vals] })),
	sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ sql: true, strings, values }),
	count: vi.fn(() => 'count()')
}));

// Stands in for the correlated subqueries the real projection builds; those
// are pinned by `entity/refs.spec.ts` against rendered SQL instead.
vi.mock('$lib/server/entity/refs', () => ({
	memberRefColumns: vi.fn(() => ({ id: 'user.id', name: 'user.name' })),
	bandRefColumns: vi.fn(() => ({ id: 'band.id', name: 'band.name' })),
	eventRefColumns: vi.fn(() => ({ id: 'event.id', title: 'event.title' })),
	toBookerRef: vi.fn((row: { bookerType: string; member?: { id?: string; name?: string } }) => ({
		type: row.bookerType === 'band' ? 'band' : 'member',
		id: row.member?.id ?? null,
		title: row.member?.name ?? 'Unknown member'
	}))
}));

vi.mock('./rrule-helpers', () => ({
	buildRRule: vi.fn(() => 'FREQ=WEEKLY;BYDAY=MO'),
	describeFrequency: vi.fn(() => 'Weekly'),
	monthlyModeOf: vi.fn(() => null)
}));

vi.mock('./config', () => ({}));

// ---------------------------------------------------------------------------
// Import module under test and mocked dependencies
// ---------------------------------------------------------------------------

import { db } from '$lib/server/db';
import { buildRRule, describeFrequency } from './rrule-helpers';

const svc = await import('./recurring-series-service');

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const SERIES_ROW = {
	id: 'series-new',
	prototypeType: 'reservation',
	prototypeId: 'res-1',
	rrule: 'FREQ=WEEKLY;BYDAY=MO',
	createdAt: new Date('2026-01-01'),
	cancelledAt: null,
	supersededBy: null
};

// ---------------------------------------------------------------------------
// Batch helper — sets up db.batch, db.insert, db.select mocks
// ---------------------------------------------------------------------------

const lastInsert = { valuesSpy: null as ReturnType<typeof vi.fn> | null };

function setupBatchMock({
	selectReturning = [SERIES_ROW]
}: {
	selectReturning?: unknown[];
} = {}) {
	vi.mocked(db.batch).mockResolvedValue([] as any);

	const valuesSpy = vi.fn().mockReturnValue(undefined);
	lastInsert.valuesSpy = valuesSpy;
	vi.mocked(db.insert).mockReturnValue({ values: valuesSpy } as any);

	vi.mocked(db.update).mockReturnValue({
		set: vi.fn().mockReturnValue({
			where: vi.fn().mockResolvedValue({ meta: { changes: 1 } })
		})
	} as any);

	vi.mocked(db.select).mockImplementation((() => ({
		from: vi.fn().mockReturnValue({
			where: vi.fn().mockReturnValue({
				limit: vi.fn().mockResolvedValue(selectReturning),
				then: (resolve: (v: unknown) => unknown) => resolve(selectReturning)
			})
		})
	})) as any);

	return { valuesSpy };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('recurring-series-service', () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	// -------------------------------------------------------------------------
	// create()
	// -------------------------------------------------------------------------

	describe('create()', () => {
		const params = {
			prototypeReservationId: 'res-1',
			frequency: 'weekly' as const,
			prototypeStartsAt: new Date('2026-06-01T10:00:00Z')
		};

		it('calls buildRRule with the prototype startsAt and frequency', async () => {
			setupBatchMock();

			await svc.create(params);

			expect(buildRRule).toHaveBeenCalledWith(
				params.prototypeStartsAt,
				params.frequency,
				'weekday'
			);
		});

		it('inserts a recurringSeries row via batch with rrule, type, and prototypeId', async () => {
			setupBatchMock();

			await svc.create(params);

			expect(lastInsert.valuesSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					prototypeType: 'reservation',
					prototypeId: 'res-1',
					rrule: 'FREQ=WEEKLY;BYDAY=MO'
				})
			);
		});

		it('calls db.batch with the queries', async () => {
			setupBatchMock();

			await svc.create(params);

			expect(db.batch).toHaveBeenCalled();
		});

		it('returns the inserted series row', async () => {
			setupBatchMock();

			const result = await svc.create(params);

			expect(result).toMatchObject({ id: 'series-new', prototypeId: 'res-1' });
		});
	});

	// -------------------------------------------------------------------------
	// createEventSeries()
	// -------------------------------------------------------------------------

	describe('createEventSeries()', () => {
		const params = {
			prototypeEventId: 'evt-1',
			frequency: 'weekly' as const,
			prototypeStartsAt: new Date('2026-06-01T19:00:00Z')
		};

		it('builds the rule and inserts a series with prototypeType "event"', async () => {
			setupBatchMock();

			await svc.createEventSeries(params);

			expect(buildRRule).toHaveBeenCalledWith(
				params.prototypeStartsAt,
				params.frequency,
				'weekday'
			);
			expect(lastInsert.valuesSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					prototypeType: 'event',
					prototypeId: 'evt-1',
					rrule: 'FREQ=WEEKLY;BYDAY=MO'
				})
			);
		});

		it('back-links the prototype event and returns the series row', async () => {
			setupBatchMock();

			const result = await svc.createEventSeries(params);

			expect(db.batch).toHaveBeenCalled();
			expect(db.update).toHaveBeenCalled();
			expect(result).toMatchObject({ id: 'series-new' });
		});
	});

	// -------------------------------------------------------------------------
	// cancel()
	// -------------------------------------------------------------------------

	describe('cancel()', () => {
		function setupCancelUpdate(rowCount: number) {
			const where = vi.fn().mockResolvedValue({ meta: { changes: rowCount } });
			const set = vi.fn().mockReturnValue({ where });
			vi.mocked(db.update).mockReturnValue({ set } as unknown as ReturnType<typeof db.update>);
			return { set };
		}

		it('updates cancelledAt for the matching series', async () => {
			const { set } = setupCancelUpdate(1);

			await svc.cancel('series-1');

			expect(set).toHaveBeenCalledWith(expect.objectContaining({ cancelledAt: expect.any(Date) }));
		});

		it('throws RecurringSeriesError when series is not found or already cancelled', async () => {
			setupCancelUpdate(0);

			await expect(svc.cancel('series-missing')).rejects.toThrow(svc.RecurringSeriesError);
			await expect(svc.cancel('series-missing')).rejects.toThrow('not found or already cancelled');
		});
	});

	// -------------------------------------------------------------------------
	// cancelAllForUser()
	// -------------------------------------------------------------------------

	describe('cancelAllForUser()', () => {
		function setupSelectForUser(rows: { seriesId: string }[]) {
			const where = vi.fn().mockResolvedValue(rows);
			const innerJoin = vi.fn().mockReturnValue({ where });
			const from = vi.fn().mockReturnValue({ innerJoin });
			vi.mocked(db.select).mockReturnValue({ from } as unknown as ReturnType<typeof db.select>);
		}

		function setupUpdateForCancel(rowCount: number) {
			const where = vi.fn().mockResolvedValue({ meta: { changes: rowCount } });
			const set = vi.fn().mockReturnValue({ where });
			vi.mocked(db.update).mockReturnValue({ set } as unknown as ReturnType<typeof db.update>);
			return { set };
		}

		it('returns 0 when there are no active series for the user', async () => {
			setupUpdateForCancel(0);

			const count = await svc.cancelAllForUser('user-1');

			expect(count).toBe(0);
		});

		it('cancels all found series and returns the cancelled count', async () => {
			setupSelectForUser([{ seriesId: 'series-a' }, { seriesId: 'series-b' }]);
			const { set } = setupUpdateForCancel(2);

			const count = await svc.cancelAllForUser('user-1');

			expect(set).toHaveBeenCalledWith(expect.objectContaining({ cancelledAt: expect.any(Date) }));
			expect(count).toBe(2);
		});
	});

	// -------------------------------------------------------------------------
	// get()
	// -------------------------------------------------------------------------

	describe('get()', () => {
		function setupGetSelect(rows: unknown[]) {
			const limit = vi.fn().mockResolvedValue(rows);
			const where = vi.fn().mockReturnValue({ limit });
			// Self-returning `leftJoin`, so the stub survives however many the
			// booker projection adds without pinning their count here.
			const joined: Record<string, unknown> = { where };
			joined.leftJoin = vi.fn().mockReturnValue(joined);
			const innerJoin2 = vi.fn().mockReturnValue(joined);
			const innerJoin1 = vi.fn().mockReturnValue({ innerJoin: innerJoin2 });
			const from = vi.fn().mockReturnValue({ innerJoin: innerJoin1 });
			vi.mocked(db.select).mockReturnValue({ from } as unknown as ReturnType<typeof db.select>);
		}

		it('returns null when the series does not exist', async () => {
			setupGetSelect([]);

			const result = await svc.get('series-missing');

			expect(result).toBeNull();
		});

		it('returns the series with prototype details when found', async () => {
			const row = {
				...SERIES_ROW,
				prototypeName: 'Alice',
				prototypeBookerType: 'user',
				prototypeBookerId: 'user-1',
				prototypeCreatedByUserId: 'user-1',
				prototypeStartsAt: new Date('2026-06-01T10:00:00Z'),
				prototypeEndsAt: new Date('2026-06-01T12:00:00Z'),
				prototypeNotes: null
			};
			setupGetSelect([row]);

			const result = await svc.get('series-new');

			expect(result).toMatchObject({ id: 'series-new', prototypeName: 'Alice' });
		});
	});

	// -------------------------------------------------------------------------
	// listActive()
	// -------------------------------------------------------------------------

	describe('listActive()', () => {
		function setupListSelect(rows: unknown[]) {
			const where = vi.fn().mockResolvedValue(rows);
			// Self-returning `leftJoin`, so the stub survives however many the
			// booker projection adds without pinning their count here.
			const joined: Record<string, unknown> = { where };
			joined.leftJoin = vi.fn().mockReturnValue(joined);
			const innerJoin2 = vi.fn().mockReturnValue(joined);
			const innerJoin1 = vi.fn().mockReturnValue({ innerJoin: innerJoin2 });
			const from = vi.fn().mockReturnValue({ innerJoin: innerJoin1 });
			vi.mocked(db.select).mockReturnValue({ from } as unknown as ReturnType<typeof db.select>);
		}

		it('returns an empty array when there are no active series', async () => {
			setupListSelect([]);

			const result = await svc.listActive();

			expect(result).toEqual([]);
		});

		it('maps results with a frequencyLabel from describeFrequency', async () => {
			const row = {
				id: 'series-1',
				rrule: 'FREQ=WEEKLY;BYDAY=MO',
				createdAt: new Date('2026-01-01'),
				cancelledAt: null,
				member: { id: 'user-1', name: 'Alice' },
				bookerType: 'user',
				bookerId: 'user-1',
				startsAt: new Date('2026-06-01T10:00:00Z'),
				endsAt: new Date('2026-06-01T12:00:00Z')
			};
			setupListSelect([row]);

			const result = await svc.listActive();

			expect(describeFrequency).toHaveBeenCalledWith(row.rrule);
			expect(result[0]).toMatchObject({ id: 'series-1', frequencyLabel: 'Weekly' });
		});
	});

	// -------------------------------------------------------------------------
	// getByReservation()
	// -------------------------------------------------------------------------

	describe('getByReservation()', () => {
		function setupGetByReservationSelect(rows: unknown[]) {
			const limit = vi.fn().mockResolvedValue(rows);
			const where = vi.fn().mockReturnValue({ limit });
			const innerJoin = vi.fn().mockReturnValue({ where });
			const from = vi.fn().mockReturnValue({ innerJoin });
			vi.mocked(db.select).mockReturnValue({ from } as unknown as ReturnType<typeof db.select>);
		}

		it('returns null when the reservation has no series', async () => {
			setupGetByReservationSelect([]);

			const result = await svc.getByReservation('res-orphan');

			expect(result).toBeNull();
		});

		it('returns the series row when found', async () => {
			setupGetByReservationSelect([SERIES_ROW]);

			const result = await svc.getByReservation('res-1');

			expect(result).toMatchObject({ id: 'series-new', prototypeId: 'res-1' });
		});
	});

	// -------------------------------------------------------------------------
	// listAll()
	// -------------------------------------------------------------------------

	describe('listAll()', () => {
		function setupListAllSelect(rows: unknown[]) {
			const offset = vi.fn().mockResolvedValue(rows);
			const limit = vi.fn().mockReturnValue({ offset });
			const $dynamic = vi.fn().mockReturnValue({ limit });
			const where = vi.fn().mockReturnValue({ $dynamic });
			// Self-returning `leftJoin`, so the stub survives however many the
			// booker projection adds without pinning their count here.
			const joined: Record<string, unknown> = { where };
			joined.leftJoin = vi.fn().mockReturnValue(joined);
			const innerJoin2 = vi.fn().mockReturnValue(joined);
			const innerJoin1 = vi.fn().mockReturnValue({ innerJoin: innerJoin2 });
			const from = vi.fn().mockReturnValue({ innerJoin: innerJoin1 });
			// First call: data query, second call: count query
			const countWhere = vi.fn().mockResolvedValue([{ count: rows.length }]);
			const countInnerJoin = vi.fn().mockReturnValue({ where: countWhere });
			const countFrom = vi.fn().mockReturnValue({ innerJoin: countInnerJoin });
			vi.mocked(db.select)
				.mockReturnValueOnce({ from } as unknown as ReturnType<typeof db.select>)
				.mockReturnValueOnce({ from: countFrom } as unknown as ReturnType<typeof db.select>);
		}

		it('returns empty rows when there are no series', async () => {
			setupListAllSelect([]);

			const result = await svc.listAll();

			expect(result.rows).toEqual([]);
		});

		it('includes cancelled series in the results', async () => {
			const cancelledRow = {
				id: 'series-cancelled',
				rrule: 'FREQ=WEEKLY;BYDAY=TU',
				createdAt: new Date('2026-01-01'),
				cancelledAt: new Date('2026-02-01'),
				member: { id: 'user-2', name: 'Bob' },
				bookerType: 'user',
				bookerId: 'user-2',
				startsAt: new Date('2026-06-01T14:00:00Z'),
				endsAt: new Date('2026-06-01T16:00:00Z')
			};
			setupListAllSelect([cancelledRow]);

			const result = await svc.listAll();

			expect(result.rows).toHaveLength(1);
			expect(result.rows[0]).toMatchObject({
				id: 'series-cancelled',
				cancelledAt: cancelledRow.cancelledAt,
				frequencyLabel: 'Weekly'
			});
			expect(describeFrequency).toHaveBeenCalledWith(cancelledRow.rrule);
		});
	});

	// -------------------------------------------------------------------------
	// listActive({ forUser })
	// -------------------------------------------------------------------------

	describe('listActive({ forUser })', () => {
		function setupListActiveSelect(rows: unknown[]) {
			const where = vi.fn().mockResolvedValue(rows);
			// Self-returning `leftJoin`, so the stub survives however many the
			// booker projection adds without pinning their count here.
			const joined: Record<string, unknown> = { where };
			joined.leftJoin = vi.fn().mockReturnValue(joined);
			const innerJoin2 = vi.fn().mockReturnValue(joined);
			const innerJoin1 = vi.fn().mockReturnValue({ innerJoin: innerJoin2 });
			const from = vi.fn().mockReturnValue({ innerJoin: innerJoin1 });
			vi.mocked(db.select).mockReturnValue({ from } as unknown as ReturnType<typeof db.select>);
		}

		it('returns an empty array when the user has no active series', async () => {
			setupListActiveSelect([]);

			const result = await svc.listActive({ forUser: 'user-1' });

			expect(result).toEqual([]);
		});

		it('returns series for the given user with frequencyLabel', async () => {
			const row = {
				id: 'series-user',
				rrule: 'FREQ=WEEKLY;BYDAY=WE',
				createdAt: new Date('2026-03-01'),
				cancelledAt: null,
				member: { id: 'user-3', name: 'Charlie' },
				bookerType: 'user',
				bookerId: 'user-3',
				startsAt: new Date('2026-06-05T09:00:00Z'),
				endsAt: new Date('2026-06-05T11:00:00Z')
			};
			setupListActiveSelect([row]);

			const result = await svc.listActive({ forUser: 'user-3' });

			expect(result).toHaveLength(1);
			expect(result[0]).toMatchObject({
				id: 'series-user',
				booker: { title: 'Charlie' },
				frequencyLabel: 'Weekly'
			});
		});
	});

	// -------------------------------------------------------------------------
	// getHistory()
	// -------------------------------------------------------------------------

	describe('getHistory()', () => {
		function setupHistorySelects(calls: unknown[][]) {
			let callIndex = 0;
			vi.mocked(db.select).mockImplementation(() => {
				const rows = calls[callIndex] ?? [];
				callIndex++;
				const limit = vi.fn().mockResolvedValue(rows);
				const where = vi.fn().mockReturnValue({ limit });
				const from = vi.fn().mockReturnValue({ where });
				return { from } as unknown as ReturnType<typeof db.select>;
			});
		}

		it('returns an empty array when the series does not exist', async () => {
			setupHistorySelects([[]]);

			const result = await svc.getHistory('series-missing');

			expect(result).toEqual([]);
		});

		it('returns only the current series when there are no predecessors or successors', async () => {
			const current = { ...SERIES_ROW, id: 'series-solo', supersededBy: null };
			setupHistorySelects([
				[current], // first call: get current
				[] // second call: look for predecessor — none
				// no forward walk since supersededBy is null
			]);

			const result = await svc.getHistory('series-solo');

			expect(result).toHaveLength(1);
			expect(result[0]).toMatchObject({ id: 'series-solo' });
		});

		it('walks backward to find predecessors', async () => {
			const current = { ...SERIES_ROW, id: 'series-c', supersededBy: null };
			const predB = { ...SERIES_ROW, id: 'series-b', supersededBy: 'series-c' };
			const predA = { ...SERIES_ROW, id: 'series-a', supersededBy: 'series-b' };

			setupHistorySelects([
				[current], // get current
				[predB], // first backward step: find predecessor of series-c
				[predA], // second backward step: find predecessor of series-b
				[] // third backward step: no more predecessors
				// no forward walk since supersededBy is null
			]);

			const result = await svc.getHistory('series-c');

			expect(result).toHaveLength(3);
			expect(result[0]).toMatchObject({ id: 'series-a' });
			expect(result[1]).toMatchObject({ id: 'series-b' });
			expect(result[2]).toMatchObject({ id: 'series-c' });
		});

		it('walks forward to find successors', async () => {
			const current = { ...SERIES_ROW, id: 'series-a', supersededBy: 'series-b' };
			const succB = { ...SERIES_ROW, id: 'series-b', supersededBy: 'series-c' };
			const succC = { ...SERIES_ROW, id: 'series-c', supersededBy: null };

			setupHistorySelects([
				[current], // get current
				[], // backward walk: no predecessors
				[succB], // forward step 1: get series-b
				[succC] // forward step 2: get series-c
				// forward stops because succC.supersededBy is null
			]);

			const result = await svc.getHistory('series-a');

			expect(result).toHaveLength(3);
			expect(result[0]).toMatchObject({ id: 'series-a' });
			expect(result[1]).toMatchObject({ id: 'series-b' });
			expect(result[2]).toMatchObject({ id: 'series-c' });
		});
	});
});
