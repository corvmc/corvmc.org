import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * #3031: a recurring booking whose first slot the same booker already holds is
 * a duplicate. Real SQLite, so the overlap and booker predicates are real.
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

const { create, createWaitlisted, DuplicateBookingError, ReservationConflictError } =
	await import('./reservation-service');
const { create: createSeries } = await import('./recurring-series-service');
const { heldBySameBooker } = await import('./same-booker-hold');
const { buildDateInTz } = await import('./timezone');

const at = (date: string, time: string) => buildDateInTz(date, time, 'America/Los_Angeles');
const NOW = at('2026-07-13', '10:00');
// Friday 18:00–20:00 club time, four days out: past the new-member notice.
const SLOT = { startsAt: at('2026-07-17', '18:00'), endsAt: at('2026-07-17', '20:00') };

const own = (userId: string) => ({
	userId,
	bookerType: 'user' as const,
	bookerId: userId,
	...SLOT
});

/** What the member remote does: book, waitlist on conflict, then start the series. */
async function bookWeekly(userId: string) {
	let row;
	try {
		row = await create(own(userId));
	} catch (err) {
		if (!(err instanceof ReservationConflictError)) throw err;
		row = await createWaitlisted(own(userId));
	}
	await createSeries({
		prototypeReservationId: row.id,
		frequency: 'weekly',
		prototypeStartsAt: SLOT.startsAt
	});
	return row;
}

const liveSeries = (userId: string) =>
	sqlite
		.prepare(
			`select count(*) as n from recurring_series s
			 join reservation r on r.id = s.prototype_id
			 where r.booker_id = ? and s.cancelled_at is null`
		)
		.get(userId) as { n: number };

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
	sqlite.exec('delete from recurring_series; delete from reservation; delete from user;');
	sqlite.exec(
		`insert into user (id, name, email) values
			('u-1', 'One', 'one@x.test'), ('u-2', 'Two', 'two@x.test')`
	);
});
afterEach(() => {
	vi.useRealTimers();
});

describe('same booker, same slot', () => {
	it('leaves one live series when one booker books the same recurring slot twice', async () => {
		await bookWeekly('u-1');

		await expect(bookWeekly('u-1')).rejects.toBeInstanceOf(DuplicateBookingError);
		expect(liveSeries('u-1').n).toBe(1);
	});

	it('still waitlists another booker behind the slot', async () => {
		await bookWeekly('u-1');

		const row = await bookWeekly('u-2');

		expect(row.status).toBe('waitlisted');
		expect(liveSeries('u-2').n).toBe(1);
	});

	it('refuses a second queue place for the same booker', async () => {
		await bookWeekly('u-2');
		await createWaitlisted(own('u-1'));

		await expect(createWaitlisted(own('u-1'))).rejects.toBeInstanceOf(DuplicateBookingError);
	});

	it('ignores a cancelled booking and the series named as excluded', async () => {
		const row = await bookWeekly('u-1');
		const slot = { bookerType: 'user' as const, bookerId: 'u-1', ...SLOT };

		expect(await heldBySameBooker(slot)).toBe(true);
		expect(await heldBySameBooker({ ...slot, excludeSeriesId: seriesOf(row.id) })).toBe(false);

		sqlite.prepare(`update reservation set status = 'cancelled' where id = ?`).run(row.id);
		expect(await heldBySameBooker(slot)).toBe(false);
	});
});

function seriesOf(reservationId: string): string {
	const r = sqlite
		.prepare(`select recurring_series_id as id from reservation where id = ?`)
		.get(reservationId) as { id: string };
	return r.id;
}
