import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `updateGroupSession` and `cancelGroupSession`.
 *
 * A session holds the practice room, so moving one re-runs the conflict check
 * and moves the held window, and calling one off gives the room back. The band
 * equivalents do neither, because a gig reserves nothing.
 */

let updates: { table: string; values: Record<string, unknown> }[] = [];
let stored: Record<string, unknown> | null = null;
let conflict = false;

function tableName(table: unknown): string {
	if (!table || typeof table !== 'object') return 'unknown';
	const sym = Object.getOwnPropertySymbols(table).find((s) => s.description === 'drizzle:Name');
	return sym ? String((table as Record<symbol, unknown>)[sym]) : 'unknown';
}

// The row `getById` reads. It is driven through the db mock rather than by
// spying on the export: an intra-module call resolves the local binding, so a
// namespace spy would never be reached.
function chainable() {
	const proxy: any = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				return (resolve: (v: unknown[]) => void) => resolve(stored ? [stored] : []);
			}
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
			insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
			update: (table: unknown) => ({
				set: (values: Record<string, unknown>) => {
					updates.push({ table: tableName(table), values });
					return {
						where: () => ({
							returning: () => Promise.resolve([{ id: 'evt-1', ...values }]),
							then: (resolve: (v: unknown) => void) => resolve(undefined)
						})
					};
				}
			}),
			delete: () => ({ where: () => Promise.resolve() })
		}
	};
});

const hasConflict = vi.fn(async () => conflict);
const cancelReservation = vi.fn(async () => undefined);
vi.mock('$lib/server/reservation/conflict-service', () => ({
	hasConflict: (...a: unknown[]) => hasConflict(...(a as []))
}));
const staffCreate = vi.fn(async () => ({ id: 'res-new' }));
vi.mock('$lib/server/reservation/reservation-service', async (importOriginal) => {
	const actual =
		await importOriginal<typeof import('$lib/server/reservation/reservation-service')>();
	return {
		...actual,
		cancel: (...a: unknown[]) => cancelReservation(...(a as [])),
		staffCreate: (...a: unknown[]) => staffCreate(...(a as []))
	};
});

const detachSlot = vi.fn(async () => undefined);
vi.mock('$lib/server/media/media-service', () => ({
	attachToSlot: vi.fn(),
	replaceSlot: vi.fn(),
	detachSlot: (...a: unknown[]) => detachSlot(...(a as []))
}));
vi.mock('$lib/server/storage', () => ({ uploadImage: vi.fn(), deleteObject: vi.fn() }));
vi.mock('$lib/server/event-bus/event-bus', () => ({ domainEvents: { emit: vi.fn() } }));
vi.mock('$lib/server/sentry', () => ({ captureException: vi.fn() }));

const { updateGroupSession, cancelGroupSession } = await import('./event-service');
const { ReservationConflictError } = await import('$lib/server/reservation/reservation-service');

const STARTS = new Date('2026-09-17T02:00:00Z');
const ENDS = new Date('2026-09-17T05:00:00Z');
const ACTOR = 'user-1';
const MOVED_START = new Date('2026-09-18T02:00:00Z');
const MOVED_END = new Date('2026-09-18T05:00:00Z');

function session(over: Record<string, unknown> = {}) {
	return {
		id: 'evt-1',
		groupId: 'club-1',
		status: 'published',
		startsAt: STARTS,
		endsAt: ENDS,
		reservationId: 'res-1',
		...over
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	updates = [];
	stored = session();
	conflict = false;
});

const reservationWrites = () => updates.filter((u) => u.table === 'reservation');
const listingWrites = () => updates.filter((u) => u.table === 'event_listing');

describe('updateGroupSession — taking and releasing the room', () => {
	// The room hold was decided at create and could never change, so a leader who
	// forgot the checkbox had to cancel the session — flipping a listing members
	// had already seen — and put up a second one. #1108.
	it('takes the room for a session that was not holding it', async () => {
		stored = session({ reservationId: null });

		await updateGroupSession('evt-1', 'club-1', ACTOR, { reserveRoom: true });

		expect(staffCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				bookerType: 'group',
				bookerId: 'club-1',
				hardHold: true,
				startsAt: STARTS,
				endsAt: ENDS,
				status: 'confirmed'
			})
		);
		expect(listingWrites().at(-1)?.values).toMatchObject({ reservationId: 'res-new' });
	});

	it('holds the room for the new window when the session moves in the same write', async () => {
		stored = session({ reservationId: null });

		await updateGroupSession('evt-1', 'club-1', ACTOR, {
			startsAt: MOVED_START,
			endsAt: MOVED_END,
			reserveRoom: true
		});

		expect(staffCreate).toHaveBeenCalledWith(
			expect.objectContaining({ startsAt: MOVED_START, endsAt: MOVED_END })
		);
	});

	it('refuses to take a room that is already taken', async () => {
		stored = session({ reservationId: null });
		conflict = true;

		await expect(
			updateGroupSession('evt-1', 'club-1', ACTOR, { reserveRoom: true })
		).rejects.toBeInstanceOf(ReservationConflictError);
		expect(staffCreate).not.toHaveBeenCalled();
	});

	it('gives the room back without cancelling the session', async () => {
		await updateGroupSession('evt-1', 'club-1', ACTOR, { reserveRoom: false });

		expect(cancelReservation).toHaveBeenCalledWith(
			'res-1',
			ACTOR,
			expect.any(String),
			expect.objectContaining({ staffOverride: true })
		);
		expect(listingWrites().at(-1)?.values).toMatchObject({ reservationId: null });
		// The listing survives — giving the room back is not calling the jam off.
		expect(listingWrites().at(-1)?.values).not.toMatchObject({ status: 'cancelled' });
	});

	it('leaves the hold alone when reserveRoom is not sent', async () => {
		await updateGroupSession('evt-1', 'club-1', ACTOR, { title: 'Renamed' });

		expect(staffCreate).not.toHaveBeenCalled();
		expect(cancelReservation).not.toHaveBeenCalled();
		expect(listingWrites().at(-1)?.values).not.toHaveProperty('reservationId');
	});

	// Asking for the state it is already in is not a second reservation.
	it('is idempotent when the wanted state is the current one', async () => {
		await updateGroupSession('evt-1', 'club-1', ACTOR, { reserveRoom: true });

		expect(staffCreate).not.toHaveBeenCalled();
		expect(cancelReservation).not.toHaveBeenCalled();
	});
});

describe('updateGroupSession', () => {
	it('moves the held room with the session', async () => {
		await updateGroupSession('evt-1', 'club-1', ACTOR, {
			startsAt: MOVED_START,
			endsAt: MOVED_END
		});

		expect(reservationWrites()[0].values).toMatchObject({
			startsAt: MOVED_START,
			endsAt: MOVED_END
		});
		expect(listingWrites()[0].values).toMatchObject({
			startsAt: MOVED_START,
			endsAt: MOVED_END
		});
	});

	/** Or the session collides with the room it is already holding. */
	it('excludes its own reservation from the conflict check', async () => {
		await updateGroupSession('evt-1', 'club-1', ACTOR, {
			startsAt: MOVED_START,
			endsAt: MOVED_END
		});
		expect(hasConflict).toHaveBeenCalledWith(MOVED_START, MOVED_END, 'res-1');
	});

	it('refuses a move into a taken slot, and moves nothing', async () => {
		conflict = true;
		await expect(
			updateGroupSession('evt-1', 'club-1', ACTOR, { startsAt: MOVED_START, endsAt: MOVED_END })
		).rejects.toBeInstanceOf(ReservationConflictError);
		expect(reservationWrites()).toEqual([]);
		expect(listingWrites()).toEqual([]);
	});

	it('does not touch the room when only the title changes', async () => {
		await updateGroupSession('evt-1', 'club-1', ACTOR, { title: 'Renamed' });
		expect(hasConflict).not.toHaveBeenCalled();
		expect(reservationWrites()).toEqual([]);
		expect(listingWrites()[0].values).toMatchObject({ title: 'Renamed' });
	});

	it('has no room to move when the session never held one', async () => {
		stored = session({ reservationId: null });
		await updateGroupSession('evt-1', 'club-1', ACTOR, {
			startsAt: MOVED_START,
			endsAt: MOVED_END
		});
		expect(hasConflict).not.toHaveBeenCalled();
		expect(reservationWrites()).toEqual([]);
	});

	/**
	 * The event id comes from the client. Without this a leader of one program
	 * could move another's session.
	 */
	it('refuses a session belonging to another group', async () => {
		await expect(updateGroupSession('evt-1', 'other-club', ACTOR, {})).rejects.toThrow();
		expect(listingWrites()).toEqual([]);
	});

	it('refuses to edit a cancelled session', async () => {
		stored = session({ status: 'cancelled' });
		await expect(updateGroupSession('evt-1', 'club-1', ACTOR, { title: 'x' })).rejects.toThrow();
	});
});

describe('cancelGroupSession', () => {
	/**
	 * The whole cost of the room being free: a cancelled meeting that kept its
	 * reservation would block the practice space for nothing.
	 */
	it('gives the room back', async () => {
		await cancelGroupSession('evt-1', 'club-1', 'user-1');

		expect(listingWrites()[0].values).toMatchObject({ status: 'cancelled' });
		expect(cancelReservation).toHaveBeenCalledWith(
			'res-1',
			'user-1',
			'Session cancelled',
			expect.objectContaining({ staffOverride: true })
		);
	});

	it('still cancels the listing when the reservation is already gone', async () => {
		cancelReservation.mockRejectedValueOnce(new Error('already cancelled'));
		await expect(cancelGroupSession('evt-1', 'club-1', 'user-1')).resolves.toBeUndefined();
		expect(listingWrites()[0].values).toMatchObject({ status: 'cancelled' });
	});

	it('has nothing to release when the session held no room', async () => {
		stored = session({ reservationId: null });
		await cancelGroupSession('evt-1', 'club-1', 'user-1');
		expect(cancelReservation).not.toHaveBeenCalled();
	});

	it('refuses a session belonging to another group', async () => {
		await expect(cancelGroupSession('evt-1', 'other-club', 'user-1')).rejects.toThrow();
		expect(listingWrites()).toEqual([]);
	});

	it('refuses a session that is already cancelled', async () => {
		stored = session({ status: 'cancelled' });
		await expect(cancelGroupSession('evt-1', 'club-1', 'user-1')).rejects.toThrow();
	});
});
