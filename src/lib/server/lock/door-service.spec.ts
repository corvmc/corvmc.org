import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Who may use the door page, and what each attempt records, on a real SQLite. */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

vi.mock('$lib/server/db', () => ({ db: testDb }));
vi.mock('$lib/server/kv', () => ({ getJson: async () => null, putJson: async () => {} }));
vi.mock('$lib/server/notification', () => ({ dispatchEmailOnly: vi.fn() }));
vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/site-config/site-config-service', () => ({
	config: async () => 'Lights off\nAmps off'
}));

const mockRemoveTemporaryUser = vi.fn();
vi.mock('./ultraloc-client', () => ({
	addLockUser: vi.fn(),
	getLockUser: vi.fn(),
	listLockUsers: vi.fn(async () => []),
	removeTemporaryUser: (...args: unknown[]) => mockRemoveTemporaryUser(...args),
	generateLockCode: () => 4242,
	LOCK_GRACE_MINUTES: 30
}));

const mockOperateDoor = vi.fn();
vi.mock('./door-command-service', () => ({
	operateDoor: (...args: unknown[]) => mockOperateDoor(...args)
}));

const {
	findOpenBooking,
	getDoorState,
	openDoor,
	checkOut,
	recordOfflineReveal,
	DoorBookingClosedError,
	DoorCheckedOutError
} = await import('./door-service');

const NOW = new Date('2026-11-02T20:00:00Z');
const s = (d: Date) => Math.floor(d.getTime() / 1000);
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

function booking(
	id: string,
	startsAt: Date,
	endsAt: Date,
	opts: { by?: string; band?: string; status?: string } = {}
) {
	sqlite
		.prepare(
			`insert into reservation (id, booker_type, booker_id, created_by_user_id, status, starts_at, ends_at)
			 values (?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			id,
			opts.band ? 'group' : 'user',
			opts.band ?? opts.by ?? 'booker',
			opts.by ?? 'booker',
			opts.status ?? 'confirmed',
			s(startsAt),
			s(endsAt)
		);
}

function poolCode(id: string) {
	sqlite
		.prepare(
			`insert into lock_fallback_code (id, code, lock_access_id, synced_at, pooled)
			 values (?, ?, ?, ?, 1)`
		)
		.run(id, `1234567${id.slice(-1)}`, `70${id.slice(-1)}`, s(minutes(-600)));
}

const attempts = () =>
	sqlite
		.prepare('select kind, outcome, code_revealed, user_id from door_access order by rowid')
		.all();
const codeRow = (id: string) =>
	sqlite.prepare('select * from lock_fallback_code where id = ?').get(id) as Record<
		string,
		unknown
	>;

beforeEach(() => {
	vi.clearAllMocks();
	for (const t of ['door_access', 'lock_fallback_code', 'reservation', 'group_member', '"group"']) {
		sqlite.exec(`delete from ${t}`);
	}
	sqlite.exec(
		`insert into "group" (id, name, slug, kind) values ('band-1', 'The Velvets', 'the-velvets', 'band')`
	);
	sqlite.exec(
		`insert into group_member (id, group_id, user_id, role, status) values
			('gm-1', 'band-1', 'bandmate', 'member', 'active'),
			('gm-2', 'band-1', 'invitee', 'member', 'pending')`
	);
	mockOperateDoor.mockResolvedValue({ outcome: 'unlocked', lockState: 'Unlocked' });
	mockRemoveTemporaryUser.mockResolvedValue(undefined);
});

describe('findOpenBooking', () => {
	it('opens 30 minutes before the start and closes at the end', async () => {
		booking('r-1', minutes(25), minutes(120));
		expect((await findOpenBooking('booker', NOW))?.id).toBe('r-1');

		sqlite.exec('delete from reservation');
		booking('r-2', minutes(35), minutes(120));
		expect(await findOpenBooking('booker', NOW)).toBeNull();

		sqlite.exec('delete from reservation');
		booking('r-3', minutes(-120), minutes(-1));
		expect(await findOpenBooking('booker', NOW)).toBeNull();
	});

	it('is open to an active member of the band it was booked for, and nobody else', async () => {
		booking('r-1', minutes(-10), minutes(60), { by: 'leader', band: 'band-1' });

		expect((await findOpenBooking('bandmate', NOW))?.bandName).toBe('The Velvets');
		expect(await findOpenBooking('invitee', NOW)).toBeNull();
		expect(await findOpenBooking('stranger', NOW)).toBeNull();
	});

	it('ignores a booking that is not confirmed', async () => {
		booking('r-1', minutes(-10), minutes(60), { status: 'cancelled' });
		expect(await findOpenBooking('booker', NOW)).toBeNull();
	});
});

describe('getDoorState', () => {
	it('claims one code on load and sends it with the page, unrevealed', async () => {
		booking('r-1', minutes(-10), minutes(60));
		poolCode('c-1');
		poolCode('c-2');

		const first = await getDoorState('booker', NOW);
		const again = await getDoorState('booker', NOW);

		expect(first.code).toBe(again.code);
		expect(first.codeRevealed).toBe(false);
		expect(first.checkoutTasks).toEqual(['Lights off', 'Amps off']);
		expect(
			sqlite.prepare('select count(*) n from lock_fallback_code where claimed_at is not null').get()
		).toEqual({ n: 1 });
	});

	it('says the pool is empty rather than failing', async () => {
		booking('r-1', minutes(-10), minutes(60));
		const state = await getDoorState('booker', NOW);
		expect(state.code).toBeNull();
		expect(state.poolEmpty).toBe(true);
	});

	it('names when the next booking opens when none is open yet', async () => {
		booking('r-1', minutes(180), minutes(240));
		const state = await getDoorState('booker', NOW);
		expect(state.booking).toBeNull();
		expect(state.next?.opensAt).toEqual(minutes(150));
	});
});

describe('openDoor', () => {
	it('checks in, then re-enters, revealing nothing while the lock confirms', async () => {
		booking('r-1', minutes(-10), minutes(60));
		poolCode('c-1');

		expect(await openDoor('booker', 'r-1', { now: NOW })).toEqual({
			kind: 'check_in',
			outcome: 'unlocked',
			code: null
		});
		expect((await openDoor('booker', 'r-1', { now: NOW })).kind).toBe('re_entry');
		expect(attempts()).toEqual([
			{ kind: 'check_in', outcome: 'unlocked', code_revealed: 0, user_id: 'booker' },
			{ kind: 're_entry', outcome: 'unlocked', code_revealed: 0, user_id: 'booker' }
		]);
	});

	it('reveals the booking’s code when the unlock does not confirm', async () => {
		booking('r-1', minutes(-10), minutes(60));
		poolCode('c-1');
		mockOperateDoor.mockResolvedValue({ outcome: 'lock_offline', lockState: null });

		const result = await openDoor('booker', 'r-1', { now: NOW });

		expect(result.code).toBe(codeRow('c-1').code);
		expect(codeRow('c-1').revealed_at).toBe(s(NOW));
		expect(attempts()).toEqual([
			{ kind: 'check_in', outcome: 'lock_offline', code_revealed: 1, user_id: 'booker' }
		]);
	});

	it('refuses a booking that is not this member’s open one, before touching the lock', async () => {
		booking('r-1', minutes(-10), minutes(60));

		await expect(openDoor('stranger', 'r-1', { now: NOW })).rejects.toBeInstanceOf(
			DoorBookingClosedError
		);
		expect(mockOperateDoor).not.toHaveBeenCalled();
	});
});

describe('checkOut', () => {
	it('locks, records it, returns an unrevealed code to the pool, and closes the page', async () => {
		booking('r-1', minutes(-10), minutes(60));
		poolCode('c-1');
		await getDoorState('booker', NOW);
		mockOperateDoor.mockResolvedValue({ outcome: 'locked', lockState: 'Locked' });

		const result = await checkOut('booker', 'r-1', { now: NOW });

		expect(result.outcome).toBe('locked');
		expect(mockOperateDoor).toHaveBeenCalledWith('lock', expect.anything());
		expect(codeRow('c-1').claimed_by_reservation_id).toBeNull();
		expect(mockRemoveTemporaryUser).not.toHaveBeenCalled();
		await expect(openDoor('booker', 'r-1', { now: NOW })).rejects.toBeInstanceOf(
			DoorCheckedOutError
		);
	});

	it('sends a revealed code its delete', async () => {
		booking('r-1', minutes(-10), minutes(60));
		poolCode('c-1');
		mockOperateDoor.mockResolvedValueOnce({ outcome: 'timed_out', lockState: 'Locked' });
		await openDoor('booker', 'r-1', { now: NOW });

		await checkOut('booker', 'r-1', { now: NOW });

		expect(mockRemoveTemporaryUser).toHaveBeenCalledWith(701);
		expect(codeRow('c-1').claimed_by_reservation_id).toBe('r-1');
	});
});

describe('recordOfflineReveal', () => {
	it('marks the booking’s code revealed for a member of it, and ignores anyone else', async () => {
		booking('r-1', minutes(-10), minutes(60), { by: 'leader', band: 'band-1' });
		poolCode('c-1');
		await getDoorState('bandmate', NOW);

		await recordOfflineReveal('stranger', 'r-1', NOW);
		expect(codeRow('c-1').revealed_at).toBeNull();

		await recordOfflineReveal('bandmate', 'r-1', NOW);
		expect(codeRow('c-1').revealed_at).toBe(s(NOW));
	});

	it('claims nothing for a booking that never held a code', async () => {
		booking('r-1', minutes(-10), minutes(60));
		poolCode('c-1');

		await recordOfflineReveal('booker', 'r-1', NOW);

		expect(codeRow('c-1').claimed_by_reservation_id).toBeNull();
	});
});
