import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * #2565: a member without a current Practice space clearance books 3 days ahead;
 * once shown around (or waived), the room's 1-hour minimum. Staff bypass both.
 * Real SQLite, so the clearance predicate and the migration's catalog row are real.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});
vi.mock('#lib/server/db/index.js', () => ({ db: testDb, getRowCount: () => 0 }));
vi.mock('#lib/server/event-bus/event-bus.js', () => ({
	domainEvents: { emit: vi.fn(), on: vi.fn() }
}));
vi.mock('#lib/server/site-config/site-config-service.js', () => ({
	config: vi.fn(async () => ''),
	getConfigsByPrefix: vi.fn(async () => ({
		operatingHoursStart: '09:00',
		operatingHoursEnd: '22:00',
		minAdvanceMinutes: 60,
		newMemberMinAdvanceMinutes: 4320
	}))
}));

const {
	create,
	createWaitlisted,
	staffCreate,
	ReservationValidationError,
	ReservationConflictError
} = await import('./reservation-service');
const { validateBooking, getAvailableSlots, noticeFor, isBookableStart } =
	await import('./conflict-service');
const { billableHours } = await import('./reservation-credit-service');
const siteConfig = await import('#lib/server/site-config/site-config-service.js');
const { getReservationConfig } = await import('./config');
const { completeOrientation, waiveOrientation } =
	await import('#lib/server/volunteer/orientation-service.js');
const { buildDateInTz } = await import('./timezone');

const at = (date: string, time: string) => buildDateInTz(date, time, 'America/Los_Angeles');
// Monday 10:00 club time. Wednesday noon is two days out; today 12:00 two hours.
const NOW = at('2026-07-13', '10:00');
const TWO_DAYS = { startsAt: at('2026-07-15', '12:00'), endsAt: at('2026-07-15', '13:00') };
const TWO_HOURS = { startsAt: at('2026-07-13', '12:00'), endsAt: at('2026-07-13', '13:00') };
const ONE_HOUR = { startsAt: at('2026-07-13', '11:00'), endsAt: at('2026-07-13', '12:00') };
const FOUR_DAYS = { startsAt: at('2026-07-17', '12:00'), endsAt: at('2026-07-17', '13:00') };

const own = (userId: string, slot: { startsAt: Date; endsAt: Date }) => ({
	userId,
	bookerType: 'user' as const,
	bookerId: userId,
	...slot
});

const grants = (userId: string) =>
	sqlite
		.prepare(
			`select granted_by_user_id as by, notes from member_certification
			 where user_id = ? and certification_id = 'practice-space'`
		)
		.all(userId);

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
	sqlite.exec(
		'delete from reservation; delete from member_certification; delete from member_orientation; delete from user;'
	);
	sqlite.exec(
		`insert into user (id, name, email) values
			('u-new', 'New', 'new@x.test'), ('u-staff', 'Staff', 'staff@x.test')`
	);
});
afterEach(() => {
	vi.useRealTimers();
});

describe('new-member notice', () => {
	it('refuses a member with no clearance booking 2 days out', async () => {
		await expect(create(own('u-new', TWO_DAYS))).rejects.toBeInstanceOf(ReservationValidationError);
		const result = await validateBooking(TWO_DAYS.startsAt, TWO_DAYS.endsAt, { userId: 'u-new' });
		expect(result.code).toBe('NEW_MEMBER_NOTICE');
	});

	it('refuses the same booking through the waitlist', async () => {
		await expect(createWaitlisted(own('u-new', TWO_DAYS))).rejects.toBeInstanceOf(
			ReservationValidationError
		);
	});

	it('accepts the member 3 or more days out', async () => {
		const row = await create(own('u-new', FOUR_DAYS));
		expect(row.status).toBe('confirmed');
	});

	it('lets the member book 2 hours out once their orientation is completed', async () => {
		sqlite.exec(`insert into member_orientation (id, user_id) values ('mo-1', 'u-new')`);
		await completeOrientation('u-new', { completedByUserId: 'u-staff' });

		const row = await create(own('u-new', TWO_HOURS));
		expect(row.status).toBe('confirmed');
		expect(grants('u-new')).toEqual([{ by: 'u-staff', notes: null }]);
	});

	it('grants it on a waiver with the reason, and never twice', async () => {
		await waiveOrientation('u-new', { waivedByUserId: 'u-staff', reason: 'Played here for years' });
		await completeOrientation('u-new', { completedByUserId: null });

		expect(grants('u-new')).toEqual([{ by: 'u-staff', notes: 'Played here for years' }]);
		expect(
			(await validateBooking(TWO_HOURS.startsAt, TWO_HOURS.endsAt, { userId: 'u-new' })).valid
		).toBe(true);
	});

	it('does not count a revoked clearance', async () => {
		await waiveOrientation('u-new', { waivedByUserId: 'u-staff', reason: 'Knows the room' });
		sqlite.exec(
			`update member_certification set revoked_at = ${Math.floor(NOW.getTime() / 1000) - 60}, revoked_reason = 'Wrong member'`
		);
		const result = await validateBooking(TWO_DAYS.startsAt, TWO_DAYS.endsAt, { userId: 'u-new' });
		expect(result.code).toBe('NEW_MEMBER_NOTICE');
	});

	it('lets staff book an uncleared member 1 hour out', async () => {
		const row = await staffCreate({ ...own('u-new', ONE_HOUR), staffUserId: 'u-staff' });
		expect(row.status).toBe('confirmed');
	});

	it('leaves a band booking on the room minimum', async () => {
		const result = await validateBooking(TWO_HOURS.startsAt, TWO_HOURS.endsAt, {
			userId: 'u-new',
			bookerType: 'group'
		});
		expect(result.valid).toBe(true);
	});

	it('offers the uncleared member no start before the notice', async () => {
		const notice = await noticeFor(await getReservationConfig(), { userId: 'u-new' });
		expect(notice).toEqual({ minutes: 4320, newMember: true, tourMinutes: 0 });

		const wednesday = await getAvailableSlots('2026-07-15', { minAdvanceMinutes: notice.minutes });
		expect(wednesday.some((s) => s.available)).toBe(false);
		const thursday = await getAvailableSlots('2026-07-16', { minAdvanceMinutes: notice.minutes });
		expect(thursday.find((s) => s.startTime === '10:00')?.available).toBe(true);
	});
});

/** #2568: with an orientation role set, a new member's booking starts with a tour. */
describe('tour time', () => {
	beforeEach(() => {
		vi.mocked(siteConfig.config).mockImplementation(async (key: string) =>
			key === 'volunteer.orientationRoleId'
				? 'role-orientation'
				: key === 'volunteer.orientationMinutes'
					? 30
					: ''
		);
	});
	afterEach(() => {
		vi.mocked(siteConfig.config).mockImplementation(async () => '');
	});

	it('holds the room from 30 minutes before the requested start, and charges the rest', async () => {
		const row = await create(own('u-new', FOUR_DAYS));
		expect(row.startsAt).toEqual(at('2026-07-17', '11:30'));
		expect(row.endsAt).toEqual(FOUR_DAYS.endsAt);
		expect(row.tourMinutes).toBe(30);
		expect(billableHours(row)).toBe(1);
	});

	it('holds it through the waitlist too', async () => {
		const row = await createWaitlisted(own('u-new', FOUR_DAYS));
		expect(row.startsAt).toEqual(at('2026-07-17', '11:30'));
		expect(row.tourMinutes).toBe(30);
	});

	it('adds no tour for a cleared member', async () => {
		await waiveOrientation('u-new', { waivedByUserId: 'u-staff', reason: 'Knows the room' });
		const row = await create(own('u-new', FOUR_DAYS));
		expect(row.startsAt).toEqual(FOUR_DAYS.startsAt);
		expect(row.tourMinutes).toBe(0);
	});

	it('adds no tour when staff book', async () => {
		const row = await staffCreate({ ...own('u-new', FOUR_DAYS), staffUserId: 'u-staff' });
		expect(row.startsAt).toEqual(FOUR_DAYS.startsAt);
		expect(row.tourMinutes).toBe(0);
	});

	it('needs the tour inside opening hours', async () => {
		const opening = { startsAt: at('2026-07-17', '09:00'), endsAt: at('2026-07-17', '10:00') };
		const result = await validateBooking(opening.startsAt, opening.endsAt, { userId: 'u-new' });
		expect(result.code).toBe('BEFORE_OPENING');

		const later = { startsAt: at('2026-07-17', '09:30'), endsAt: at('2026-07-17', '10:30') };
		const row = await create(own('u-new', later));
		expect(row.startsAt).toEqual(at('2026-07-17', '09:00'));
	});

	it('refuses a tour that overlaps another booking', async () => {
		await staffCreate({
			...own('u-staff', { startsAt: at('2026-07-17', '11:30'), endsAt: at('2026-07-17', '12:00') }),
			bookerType: 'group',
			bookerId: 'band-1'
		});
		await expect(create(own('u-new', FOUR_DAYS))).rejects.toBeInstanceOf(ReservationConflictError);
	});

	it('offers no start whose tour slot is taken', async () => {
		await staffCreate({
			...own('u-staff', { startsAt: at('2026-07-17', '11:30'), endsAt: at('2026-07-17', '12:00') }),
			bookerType: 'group',
			bookerId: 'band-1'
		});
		const notice = await noticeFor(await getReservationConfig(), { userId: 'u-new' });
		expect(notice.tourMinutes).toBe(30);
		const slots = await getAvailableSlots('2026-07-17', { minAdvanceMinutes: notice.minutes });
		const index = (t: string) => slots.findIndex((s) => s.startTime === t);
		expect(isBookableStart(slots, index('12:00'), 2, 1)).toBe(false);
		expect(isBookableStart(slots, index('12:30'), 2, 1)).toBe(true);
		expect(isBookableStart(slots, index('09:00'), 2, 1)).toBe(false);
		expect(isBookableStart(slots, index('12:00'), 2, 0)).toBe(true);
	});
});
