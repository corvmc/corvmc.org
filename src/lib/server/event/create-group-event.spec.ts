import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `createGroupEvent` — the first path outside the staff panel that reserves the
 * room.
 *
 * What is worth pinning is the arrangement rather than the fields. The room is
 * held *for the event* and not booked *by the group*, which is one enum value
 * away from implying a program has a balance to spend; the reservation is
 * written before the event so the row is never half-linked, which means a failed
 * insert owes a compensating delete; and a program's session is not a bill, so
 * it writes no `event_band` credit the way a band gig does.
 */

let inserts: { table: string; rows: Record<string, unknown>[] }[] = [];
let deletes: string[] = [];
let eventInsertThrows = false;
let conflict = false;

function tableName(table: unknown): string {
	if (!table || typeof table !== 'object') return 'unknown';
	const sym = Object.getOwnPropertySymbols(table).find((s) => s.description === 'drizzle:Name');
	return sym ? String((table as Record<symbol, unknown>)[sym]) : 'unknown';
}

function chainable() {
	const proxy: any = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') return (resolve: (v: unknown[]) => void) => resolve([]);
			return () => proxy;
		}
	});
	return proxy;
}

vi.mock('$lib/server/db', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/db')>();
	return {
		...actual,
		db: {
			select: () => chainable(),
			insert: (table: unknown) => ({
				values: (v: Record<string, unknown> | Record<string, unknown>[]) => {
					const rows = Array.isArray(v) ? v : [v];
					const name = tableName(table);
					inserts.push({ table: name, rows });
					const chain = {
						onConflictDoNothing: () => chain,
						returning: () =>
							name === 'event' && eventInsertThrows
								? Promise.reject(new Error('insert failed'))
								: Promise.resolve(rows.map((r) => ({ id: (r.id as string) ?? 'row-1', ...r }))),
						then: (resolve: (v: unknown) => void) => resolve(undefined)
					};
					return chain;
				}
			}),
			update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
			delete: (table: unknown) => ({
				where: () => {
					deletes.push(tableName(table));
					return Promise.resolve();
				}
			})
		}
	};
});

const staffCreate = vi.fn(async () => ({ id: 'res-1' }));
const hasConflict = vi.fn(async () => conflict);

// Two modules, not one: `staffCreate` is in `reservation-service` and
// `hasConflict` is in `conflict-service`. Mocking only the first left the real
// conflict check running, which reaches for KV and fails with a message about
// initialization rather than about the room.
vi.mock('$lib/server/reservation/reservation-service', async (importOriginal) => {
	const actual =
		await importOriginal<typeof import('$lib/server/reservation/reservation-service')>();
	return { ...actual, staffCreate: (...a: unknown[]) => staffCreate(...(a as [])) };
});
vi.mock('$lib/server/reservation/conflict-service', () => ({
	hasConflict: (...a: unknown[]) => hasConflict(...(a as []))
}));

vi.mock('$lib/server/storage', () => ({ uploadImage: vi.fn(), deleteObject: vi.fn() }));
vi.mock('$lib/server/media/media-service', () => ({ attachToSlot: vi.fn(), detachSlot: vi.fn() }));
vi.mock('$lib/server/event-bus/event-bus', () => ({ domainEvents: { emit: vi.fn() } }));
vi.mock('$lib/server/sentry', () => ({ captureException: vi.fn() }));

const { createGroupEvent } = await import('./event-service');
const { ReservationConflictError } = await import('$lib/server/reservation/reservation-service');

function rowsFor(table: string) {
	return inserts.filter((i) => i.table === table).flatMap((i) => i.rows);
}

const STARTS = new Date('2026-09-17T02:00:00Z');
const ENDS = new Date('2026-09-17T05:00:00Z');

function params(over: Record<string, unknown> = {}) {
	return {
		groupId: 'club-1',
		createdByUserId: 'user-1',
		title: 'Monthly jam',
		startsAt: STARTS,
		endsAt: ENDS,
		...over
	} as Parameters<typeof createGroupEvent>[0];
}

beforeEach(() => {
	vi.clearAllMocks();
	inserts = [];
	deletes = [];
	eventInsertThrows = false;
	conflict = false;
	staffCreate.mockResolvedValue({ id: 'res-1' });
});

// ---------------------------------------------------------------------------

describe('without a room booking', () => {
	it('creates a group-sourced event owned by the group', async () => {
		await createGroupEvent(params());

		const [evt] = rowsFor('event');
		expect(evt).toMatchObject({ groupId: 'club-1', source: 'group', reservationId: null });
		expect(staffCreate).not.toHaveBeenCalled();
	});

	it('writes the group its event_group row', async () => {
		await createGroupEvent(params());
		expect(rowsFor('event_group')).toHaveLength(1);
	});

	/**
	 * A band gig writes its owner in as the headliner. A club's jam has no bill,
	 * and crediting the club as an act would put a program into every "bands who
	 * played here" read.
	 */
	it('writes no lineup credit', async () => {
		await createGroupEvent(params());
		expect(rowsFor('event_band')).toHaveLength(0);
	});
});

describe('holding the room', () => {
	it('books the event, not the group, and spends nothing', async () => {
		await createGroupEvent(
			params({ reservation: { startsAt: STARTS, endsAt: ENDS, overrideConflicts: false } })
		);

		const [call] = staffCreate.mock.calls as unknown as [Record<string, unknown>][];
		// `'event'`, never `'group'`: booking as the group would imply the group
		// has a balance, which is exactly what a sanctioned program does not need.
		expect(call[0]).toMatchObject({ bookerType: 'event', status: 'confirmed' });
		// The reservation points at the event, and the event links back.
		expect(call[0].bookerId).toBe(rowsFor('event')[0].id);
		expect(rowsFor('event')[0].reservationId).toBe('res-1');
	});

	it('refuses a slot that is already taken', async () => {
		conflict = true;

		await expect(
			createGroupEvent(
				params({ reservation: { startsAt: STARTS, endsAt: ENDS, overrideConflicts: false } })
			)
		).rejects.toBeInstanceOf(ReservationConflictError);

		// Nothing written — the conflict check runs before any insert.
		expect(rowsFor('event')).toHaveLength(0);
		expect(staffCreate).not.toHaveBeenCalled();
	});

	it('honours an override', async () => {
		conflict = true;

		await createGroupEvent(
			params({ reservation: { startsAt: STARTS, endsAt: ENDS, overrideConflicts: true } })
		);

		expect(hasConflict).not.toHaveBeenCalled();
		expect(staffCreate).toHaveBeenCalledTimes(1);
	});

	/**
	 * D1 has no interactive transactions, so the reservation is written first and
	 * the event inserted with the link already set. That ordering is what makes
	 * the compensating delete necessary: without it a failed insert leaves the
	 * room held for an event that does not exist, and nothing points at it.
	 */
	it('releases the room when the event insert fails', async () => {
		eventInsertThrows = true;

		await expect(
			createGroupEvent(
				params({ reservation: { startsAt: STARTS, endsAt: ENDS, overrideConflicts: false } })
			)
		).rejects.toThrow('insert failed');

		expect(deletes).toContain('reservation');
	});

	it('deletes nothing when there was no reservation to release', async () => {
		eventInsertThrows = true;

		await expect(createGroupEvent(params())).rejects.toThrow('insert failed');

		expect(deletes).toHaveLength(0);
	});
});

describe('validation', () => {
	it('refuses an end at or before the start', async () => {
		await expect(createGroupEvent(params({ endsAt: STARTS }))).rejects.toMatchObject({
			name: 'EventValidationError',
			field: 'endsAt'
		});
	});

	it('refuses doors after the start', async () => {
		await expect(
			createGroupEvent(params({ doorsAt: new Date('2026-09-17T03:00:00Z') }))
		).rejects.toMatchObject({ name: 'EventValidationError', field: 'doorsAt' });
	});
});
