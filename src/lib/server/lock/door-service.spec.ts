import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Who may use the door page, and what each attempt records, on a real SQLite. */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));
vi.mock('#lib/server/kv.js', () => ({ getJson: async () => null, putJson: async () => {} }));
vi.mock('#lib/server/notification/index.js', () => ({ dispatchEmailOnly: vi.fn() }));
vi.mock('$app/env/private', async () => (await import('#lib/testing/env-mock.js')).envMock({}));
vi.mock('#lib/server/site-config/site-config-service.js', () => ({
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
	doorRecordFor,
	readOutCodeFor,
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

/** A pool code; `claimedBy` is a booking whose door-code notice already went out. */
function poolCode(id: string, claimedBy: string | null = null) {
	const at = claimedBy ? s(minutes(-600)) : null;
	sqlite
		.prepare(
			`insert into lock_fallback_code
			 (id, code, lock_access_id, synced_at, pooled, claimed_by_reservation_id, claimed_at, revealed_at)
			 values (?, ?, ?, ?, 1, ?, ?, ?)`
		)
		.run(id, `1234567${id.slice(-1)}`, `70${id.slice(-1)}`, s(minutes(-600)), claimedBy, at, at);
}

const claimedCount = () =>
	sqlite.prepare('select count(*) n from lock_fallback_code where claimed_at is not null').get();

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
	it('sends the code the booking already holds with the page', async () => {
		booking('r-1', minutes(-10), minutes(60));
		poolCode('c-1', 'r-1');
		poolCode('c-2');

		const state = await getDoorState('booker', NOW);

		expect(state.code).toBe(codeRow('c-1').code);
		expect(state.checkoutTasks).toEqual(['Lights off', 'Amps off']);
		expect(claimedCount()).toEqual({ n: 1 });
	});

	it('claims no code for a booking that holds none', async () => {
		booking('r-1', minutes(-10), minutes(60));
		poolCode('c-1');

		const state = await getDoorState('booker', NOW);

		expect(state.code).toBeNull();
		expect(claimedCount()).toEqual({ n: 0 });
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

	it('shows the booking’s code when the unlock does not confirm', async () => {
		booking('r-1', minutes(-10), minutes(60));
		poolCode('c-1', 'r-1');
		mockOperateDoor.mockResolvedValue({ outcome: 'lock_offline', lockState: null });

		const result = await openDoor('booker', 'r-1', { now: NOW });

		expect(result.code).toBe(codeRow('c-1').code);
		expect(attempts()).toEqual([
			{ kind: 'check_in', outcome: 'lock_offline', code_revealed: 1, user_id: 'booker' }
		]);
	});

	it('claims nothing when the unlock fails and the booking holds no code', async () => {
		booking('r-1', minutes(-10), minutes(60));
		poolCode('c-1');
		mockOperateDoor.mockResolvedValue({ outcome: 'timed_out', lockState: 'Locked' });

		const result = await openDoor('booker', 'r-1', { now: NOW });

		expect(result.code).toBeNull();
		expect(claimedCount()).toEqual({ n: 0 });
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
	it('locks, records it, sends the booking’s code its delete, and closes the page', async () => {
		booking('r-1', minutes(-10), minutes(60));
		poolCode('c-1', 'r-1');
		mockOperateDoor.mockResolvedValue({ outcome: 'locked', lockState: 'Locked' });

		const result = await checkOut('booker', 'r-1', { now: NOW });

		expect(result.outcome).toBe('locked');
		expect(mockOperateDoor).toHaveBeenCalledWith('lock', expect.anything());
		expect(mockRemoveTemporaryUser).toHaveBeenCalledWith(701);
		// Removed only once the daily job sees it gone from the lock.
		expect(codeRow('c-1').removed_at).toBeNull();
		await expect(openDoor('booker', 'r-1', { now: NOW })).rejects.toBeInstanceOf(
			DoorCheckedOutError
		);
	});
});

describe('staff', () => {
	it('reads a booking’s door record: check-in, check-out, attempts and its code', async () => {
		booking('r-1', minutes(-10), minutes(60));
		poolCode('c-1', 'r-1');
		mockOperateDoor.mockResolvedValueOnce({ outcome: 'timed_out', lockState: 'Locked' });
		await openDoor('booker', 'r-1', { now: NOW });

		const record = await doorRecordFor('r-1');

		expect(record.checkedInAt).not.toBeNull();
		expect(record.checkedOutAt).toBeNull();
		expect(record.attempts).toMatchObject([
			{ kind: 'check_in', outcome: 'timed_out', codeRevealed: true }
		]);
		expect(record.code).toEqual({ code: codeRow('c-1').code, revealedAt: expect.any(Date) });
	});

	it('reads out the code the booking holds', async () => {
		booking('r-1', minutes(60), minutes(120));
		poolCode('c-1', 'r-1');
		poolCode('c-2');

		expect(await readOutCodeFor('r-1')).toBe(codeRow('c-1').code);
		expect(claimedCount()).toEqual({ n: 1 });
	});

	it('claims one for a booking whose notice has not gone out', async () => {
		booking('r-1', minutes(60 * 30), minutes(60 * 32));
		poolCode('c-1');

		expect(await readOutCodeFor('r-1')).toBe(codeRow('c-1').code);
		expect(codeRow('c-1').claimed_by_reservation_id).toBe('r-1');
		expect(codeRow('c-1').revealed_at).not.toBeNull();
	});
});
