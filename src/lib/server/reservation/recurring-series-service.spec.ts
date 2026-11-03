import { describe, it, expect, vi, beforeEach } from 'vitest';

// Series creation and the read paths, against a real SQLite. cancel() and
// cancelAllForUser() have their own real-SQLite specs (recurring-series-cancel,
// recurring-series-lapse).

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

// better-sqlite3's drizzle has no `batch`; D1's runs the statements in order, as this does.
vi.mock('$lib/server/db', () => ({
	db: Object.assign(testDb, {
		batch: async (stmts: PromiseLike<unknown>[]) => {
			const out = [];
			for (const s of stmts) out.push(await s);
			return out;
		}
	}),
	getRowCount: (r: unknown) => Number((r as { changes?: number })?.changes ?? 0)
}));

const svc = await import('./recurring-series-service');
const { buildRRule } = await import('./rrule-helpers');

const T0 = 1_780_000_000; // seconds
const WEEKLY = buildRRule(new Date(T0 * 1000), 'weekly');

function user(id: string, name: string) {
	sqlite
		.prepare(`insert into user (id, name, email) values (?, ?, ?)`)
		.run(id, name, `${id}@example.com`);
}

function booking(id: string, createdBy: string, seriesId: string | null = null, at = T0) {
	sqlite
		.prepare(
			`insert into reservation (id, booker_type, booker_id, created_by_user_id, status, starts_at, ends_at, recurring_series_id)
			 values (?, 'user', ?, ?, 'confirmed', ?, ?, ?)`
		)
		.run(id, createdBy, createdBy, at, at + 7200, seriesId);
}

function series(
	id: string,
	opts: {
		prototypeId: string;
		type?: string;
		createdBy?: string;
		supersededBy?: string | null;
		cancelledAt?: number | null;
		rrule?: string;
	}
) {
	sqlite
		.prepare(
			`insert into recurring_series (id, prototype_type, prototype_id, rrule, created_by, superseded_by, cancelled_at, created_at)
			 values (?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			id,
			opts.type ?? 'reservation',
			opts.prototypeId,
			opts.rrule ?? WEEKLY,
			opts.createdBy ?? 'user-1',
			opts.supersededBy ?? null,
			opts.cancelledAt ?? null,
			T0
		);
}

function event(id: string, recurringSeriesId: string | null = null) {
	sqlite
		.prepare(
			`insert into event_listing (id, title, starts_at, ends_at, created_by_user_id, recurring_series_id)
			 values (?, 'Jam', ?, ?, 'user-1', ?)`
		)
		.run(id, T0, T0 + 7200, recurringSeriesId);
}

beforeEach(() => {
	for (const t of ['recurring_series', 'reservation', 'event_listing', 'user']) {
		sqlite.exec(`delete from "${t}"`);
	}
	user('user-1', 'Alice');
	user('user-2', 'Bob');
});

describe('create()', () => {
	const params = {
		prototypeReservationId: 'res-1',
		frequency: 'weekly' as const,
		prototypeStartsAt: new Date('2026-06-01T17:00:00Z')
	};

	it('inserts the series, owned by the prototype’s creator, and back-links the prototype', async () => {
		booking('res-1', 'user-2');
		booking('res-other', 'user-1');

		const result = await svc.create(params);

		expect(result).toMatchObject({
			prototypeType: 'reservation',
			prototypeId: 'res-1'
		});
		expect(JSON.parse(result.rrule)).toMatchObject({ freq: 'weekly', interval: 1 });
		expect(sqlite.prepare('select created_by from recurring_series').get()).toEqual({
			created_by: 'user-2'
		});
		expect(
			sqlite.prepare('select id, recurring_series_id as s from reservation order by id').all()
		).toEqual([
			{ id: 'res-1', s: result.id },
			{ id: 'res-other', s: null }
		]);
	});

	it('refuses a prototype that does not exist', async () => {
		await expect(svc.create(params)).rejects.toThrow(svc.RecurringSeriesError);
		expect(sqlite.prepare('select count(*) as n from recurring_series').get()).toEqual({ n: 0 });
	});
});

describe('createEventSeries()', () => {
	const params = {
		prototypeEventId: 'evt-1',
		frequency: 'weekly' as const,
		prototypeStartsAt: new Date('2026-06-01T19:00:00Z')
	};

	it('inserts a series with prototypeType "event_listing" and back-links the event', async () => {
		event('evt-1');

		const result = await svc.createEventSeries(params);

		expect(result).toMatchObject({ prototypeType: 'event_listing', prototypeId: 'evt-1' });
		expect(sqlite.prepare('select recurring_series_id as s from event_listing').get()).toEqual({
			s: result.id
		});
	});

	it('refuses an event that already belongs to a series', async () => {
		event('evt-1', 's-0');

		await expect(svc.createEventSeries(params)).rejects.toThrow(svc.RecurringSeriesError);
		expect(sqlite.prepare('select count(*) as n from recurring_series').get()).toEqual({ n: 0 });
	});
});

describe('get()', () => {
	it('returns null when the series does not exist', async () => {
		expect(await svc.get('series-missing')).toBeNull();
	});

	it('returns the series with prototype details when found', async () => {
		booking('res-1', 'user-1');
		series('series-1', { prototypeId: 'res-1' });

		const result = await svc.get('series-1');

		expect(result).toMatchObject({
			id: 'series-1',
			prototypeName: 'Alice',
			prototypeBookerType: 'user',
			prototypeStartsAt: new Date(T0 * 1000),
			booker: { type: 'member', id: 'user-1' },
			prototype: { type: 'reservation', id: 'res-1' },
			frequencyLabel: expect.any(String)
		});
	});
});

describe('listActive()', () => {
	beforeEach(() => {
		booking('res-a', 'user-1');
		booking('res-b', 'user-2');
		booking('res-c', 'user-1');
		booking('res-d', 'user-1');
		series('live-a', { prototypeId: 'res-a', createdBy: 'user-1' });
		series('live-b', { prototypeId: 'res-b', createdBy: 'user-2' });
		series('cancelled', { prototypeId: 'res-c', cancelledAt: T0 });
		series('superseded', { prototypeId: 'res-d', supersededBy: 'live-a' });
		event('evt-1');
		series('event-series', { prototypeId: 'evt-1', type: 'event_listing' });
	});

	it('lists live reservation series only, with a frequency label', async () => {
		const result = await svc.listActive();

		expect(result.map((r) => r.id).sort()).toEqual(['live-a', 'live-b']);
		expect(result[0].frequencyLabel).toEqual(expect.any(String));
	});

	it('narrows to the given user', async () => {
		const result = await svc.listActive({ forUser: 'user-2' });

		expect(result.map((r) => [r.id, r.booker.title])).toEqual([['live-b', 'Bob']]);
	});
});

describe('getByReservation()', () => {
	it('returns null when the reservation has no series', async () => {
		booking('res-orphan', 'user-1');
		expect(await svc.getByReservation('res-orphan')).toBeNull();
	});

	it('returns the series a reservation was cut from', async () => {
		series('series-1', { prototypeId: 'res-1' });
		booking('res-1', 'user-1', 'series-1');
		booking('res-2', 'user-1', 'series-1', T0 + 604_800);

		expect(await svc.getByReservation('res-2')).toMatchObject({
			id: 'series-1',
			prototypeId: 'res-1'
		});
	});
});

describe('listAll()', () => {
	it('returns empty rows when there are no series', async () => {
		expect((await svc.listAll()).rows).toEqual([]);
	});

	it('includes cancelled series but not superseded ones', async () => {
		booking('res-a', 'user-1');
		booking('res-b', 'user-2');
		series('cancelled', { prototypeId: 'res-b', cancelledAt: T0 + 10 });
		series('superseded', { prototypeId: 'res-a', supersededBy: 'cancelled' });

		const result = await svc.listAll();

		expect(result.rows).toHaveLength(1);
		expect(result.rows[0]).toMatchObject({
			id: 'cancelled',
			cancelledAt: new Date((T0 + 10) * 1000),
			frequencyLabel: expect.any(String)
		});
	});
});

describe('getHistory()', () => {
	beforeEach(() => {
		booking('res-1', 'user-1');
		series('series-a', { prototypeId: 'res-1', supersededBy: 'series-b' });
		series('series-b', { prototypeId: 'res-1', supersededBy: 'series-c' });
		series('series-c', { prototypeId: 'res-1' });
		series('series-solo', { prototypeId: 'res-1' });
	});

	it('returns an empty array when the series does not exist', async () => {
		expect(await svc.getHistory('series-missing')).toEqual([]);
	});

	it('returns only the current series when there are no predecessors or successors', async () => {
		expect((await svc.getHistory('series-solo')).map((s) => s.id)).toEqual(['series-solo']);
	});

	it.each(['series-a', 'series-b', 'series-c'])(
		'walks both ways from %s to the whole chain, oldest first',
		async (start) => {
			expect((await svc.getHistory(start)).map((s) => s.id)).toEqual([
				'series-a',
				'series-b',
				'series-c'
			]);
		}
	);
});
