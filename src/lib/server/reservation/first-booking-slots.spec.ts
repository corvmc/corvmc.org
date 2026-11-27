import { describe, it, expect, beforeEach, vi } from 'vitest';
import { addCalendarDays, forEachClockEdge } from '#lib/test/clock-edges.js';
import type { TimeSlot } from '#lib/server/db/schema/reservation.js';

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const { pickFirstBookingSlots, hasBooked } = await import('./first-booking-slots');
const { bookableDateStrs, buildDaySlots } = await import('./conflict-service');
const { buildDateInTz } = await import('./timezone');

const config = {
	operatingHoursStart: '09:00',
	operatingHoursEnd: '22:00',
	timeSlotMinutes: 30,
	bufferMinutes: 0,
	minAdvanceMinutes: 0,
	maxAdvanceDaysOneoff: 14,
	minDurationHours: 1
} as never;

/** One day of half-hour slots from 09:00 to 22:00, with `taken` start times blocked. */
function day(taken: string[] = []): TimeSlot[] {
	const slots: TimeSlot[] = [];
	for (let m = 9 * 60; m < 22 * 60; m += 30) {
		const at = (t: number) =>
			`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
		slots.push({ startTime: at(m), endTime: at(m + 30), available: !taken.includes(at(m)) });
	}
	return slots;
}

const dates = ['2026-06-15', '2026-06-16', '2026-06-17', '2026-06-18', '2026-06-19'];
const all = (slots: TimeSlot[]) => new Map(dates.map((d) => [d, slots]));
const opts = { sessionSlots: 4, tourSlots: 0 };

describe('pickFirstBookingSlots', () => {
	it('offers one session a day, the earliest peak start, at most three', () => {
		const picked = pickFirstBookingSlots(dates, all(day()), opts);
		expect(picked).toEqual([
			{ date: '2026-06-15', startTime: '15:00', endTime: '17:00' },
			{ date: '2026-06-16', startTime: '15:00', endTime: '17:00' },
			{ date: '2026-06-17', startTime: '15:00', endTime: '17:00' }
		]);
	});

	it('takes a 17:30 start as peak', () => {
		const slots = day(['15:00', '15:30', '16:00', '16:30', '17:00']);
		const [first] = pickFirstBookingSlots(dates, all(slots), opts);
		expect(first.startTime).toBe('17:30');
	});

	it('skips a peak run that a booking breaks', () => {
		const slots = day(['16:30']);
		const [first] = pickFirstBookingSlots(dates, all(slots), opts);
		// 15:00 to 17:00 spans the 16:30 block, so the first whole 2 hours start at 17:00.
		expect(first.startTime).toBe('17:00');
	});

	it('falls back to any start when no day has a peak start', () => {
		const slots = day(['15:00', '15:30', '16:00', '16:30', '17:00', '17:30']);
		const picked = pickFirstBookingSlots(dates, all(slots), opts);
		expect(picked).toHaveLength(3);
		expect(picked.every((s) => s.startTime === '09:00')).toBe(true);
	});

	it('leaves out a day whose only late start is 18:00 while another day has a peak start', () => {
		const blocked = day(['15:00', '15:30', '16:00', '16:30', '17:00', '17:30']);
		const map = new Map([
			['2026-06-15', blocked],
			['2026-06-16', day()]
		]);
		const picked = pickFirstBookingSlots(['2026-06-15', '2026-06-16'], map, opts);
		expect(picked.map((s) => s.date)).toEqual(['2026-06-16']);
	});

	it('returns nothing when no day has room', () => {
		const slots = day().map((s) => ({ ...s, available: false }));
		expect(pickFirstBookingSlots(dates, all(slots), opts)).toEqual([]);
	});

	it('needs a new member’s tour slots free before the start', () => {
		const slots = day(['14:30']);
		const [first] = pickFirstBookingSlots(dates, all(slots), { sessionSlots: 4, tourSlots: 2 });
		// 15:00 needs 14:00 to 15:00 for the tour; 14:30 is taken, so 15:30 is out too.
		expect(first.startTime).toBe('16:00');
	});

	it('checks every slot of a session longer than two hours', () => {
		const slots = day(['17:00']);
		const [short] = pickFirstBookingSlots(dates, all(slots), { sessionSlots: 4, tourSlots: 0 });
		const [long] = pickFirstBookingSlots(dates, all(slots), { sessionSlots: 6, tourSlots: 0 });
		expect(short).toEqual({ date: '2026-06-15', startTime: '15:00', endTime: '17:00' });
		// Three hours must clear 17:00, so the first whole run starts at 17:30.
		expect(long).toEqual({ date: '2026-06-15', startTime: '17:30', endTime: '20:30' });
	});
});

describe('the window at the clock edges', () => {
	forEachClockEdge(
		'offers consecutive club days from today, each session two hours long',
		(edge) => {
			const days = bookableDateStrs(config, 'user', edge.at);
			expect(days).toHaveLength(14);
			expect(days[0]).toBe(edge.clubDate);
			expect(days[13]).toBe(addCalendarDays(edge.clubDate, 13));

			const slotsByDate = new Map(
				days.map((d) => [d, buildDaySlots(d, config, [], [], edge.at.getTime(), 0)])
			);
			const picked = pickFirstBookingSlots(days, slotsByDate, opts);
			expect(picked).toHaveLength(3);
			for (const s of picked) {
				const ms =
					buildDateInTz(s.date, s.endTime, 'America/Los_Angeles').getTime() -
					buildDateInTz(s.date, s.startTime, 'America/Los_Angeles').getTime();
				expect(ms).toBe(2 * 60 * 60 * 1000);
				expect(s.startTime >= '15:00' && s.startTime < '18:00').toBe(true);
			}
		}
	);
});

describe('hasBooked', () => {
	beforeEach(() => {
		sqlite.exec('delete from reservation');
	});

	const insert = (id: string, status: string, createdBy: string, bookerType = 'user') =>
		sqlite.exec(
			`insert into reservation (id, booker_type, booker_id, created_by_user_id, status, starts_at, ends_at)
			values ('${id}', '${bookerType}', '${createdBy}', '${createdBy}', '${status}', 1000, 2000)`
		);

	it('is false with no reservations', async () => {
		expect(await hasBooked('user-1')).toBe(false);
	});

	it('is false when the only reservation is cancelled', async () => {
		insert('r1', 'cancelled', 'user-1');
		expect(await hasBooked('user-1')).toBe(false);
	});

	it('is true for a waitlisted reservation', async () => {
		insert('r1', 'waitlisted', 'user-1');
		expect(await hasBooked('user-1')).toBe(true);
	});

	it('is true for a band booking the member made', async () => {
		insert('r1', 'confirmed', 'user-1', 'group');
		expect(await hasBooked('user-1')).toBe(true);
	});

	it('is false when another member booked', async () => {
		insert('r1', 'confirmed', 'user-2');
		expect(await hasBooked('user-1')).toBe(false);
	});
});
