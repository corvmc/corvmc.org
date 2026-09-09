import { describe, it, expect, vi } from 'vitest';
import { mockUser } from '$lib/server/db/test-factory';

// ---------------------------------------------------------------------------
// The start-time list used to contain only the free slots, so a member who
// wanted 10 AM saw a list that simply did not have it — no way to tell "someone
// has the room" from "the app is broken", and the policy strip above it says
// 9 AM – 10 PM. #874.
// ---------------------------------------------------------------------------

vi.mock('$lib/server/reservation/timezone', () => ({
	formatDateInTz: vi.fn((d: Date) => d.toISOString().slice(0, 10)),
	buildDateInTz: vi.fn((date: string, time: string) => new Date(`${date}T${time}:00Z`))
}));

vi.mock('$lib/server/reservation/config', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/reservation/config')>()),
	getReservationConfig: vi.fn(async () => ({
		maxAdvanceDaysOneoff: 14,
		minDurationHours: 1,
		maxDurationHours: 8,
		timeSlotMinutes: 30,
		hourlyRateCents: 1500
	}))
}));

// 10:00–11:00 is taken. 09:30 and 12:00 are free but have too little room after
// them to fit the one-hour minimum — a different thing from being booked.
vi.mock('$lib/server/reservation/conflict-service', () => ({
	getAvailableSlots: vi.fn(async () => [
		{ startTime: '09:00', available: true },
		{ startTime: '09:30', available: true },
		{ startTime: '10:00', available: false },
		{ startTime: '10:30', available: false },
		{ startTime: '11:00', available: true },
		{ startTime: '11:30', available: true },
		{ startTime: '12:00', available: true }
	]),
	getConflictDetails: vi.fn(),
	getValidationWarnings: vi.fn()
}));

const testUser = mockUser({ id: 'user-1', name: 'Test Member', email: 'member@example.com' });

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		locals: { user: testUser },
		url: new URL('http://localhost/member/reservations'),
		request: { headers: new Headers() }
	}),
	form: (_schema: unknown, handler: (...args: any[]) => any) => {
		const fn = handler;
		(fn as any).__ = { type: 'form' };
		(fn as any).for = () => fn;
		return fn;
	},
	query: (...args: unknown[]) => {
		const handler = typeof args[0] === 'function' ? args[0] : args[1];
		const fn = handler as (...args: any[]) => any;
		(fn as any).__ = { type: 'query' };
		return fn;
	}
}));

const { getReservationStartTimes } = (await import('$lib/remote/reservations.remote')) as any;

type Option = { value: string; label: string; disabled?: boolean };

describe('getReservationStartTimes', () => {
	it('lists every operating-hour slot, not only the bookable ones', async () => {
		const options: Option[] = await getReservationStartTimes('2026-09-09');

		expect(options.map((o) => o.value)).toEqual([
			'09:00',
			'09:30',
			'10:00',
			'10:30',
			'11:00',
			'11:30',
			'12:00'
		]);
	});

	it('marks a taken slot as booked rather than dropping it', async () => {
		const options: Option[] = await getReservationStartTimes('2026-09-09');
		const taken = options.find((o) => o.value === '10:00')!;

		expect(taken.disabled).toBe(true);
		expect(taken.label).toContain('booked');
	});

	// Free, but with too little room after it — saying "booked" there would be a
	// claim about somebody else's booking that is not true.
	it('distinguishes a slot that is free but too short', async () => {
		const options: Option[] = await getReservationStartTimes('2026-09-09');
		const short = options.find((o) => o.value === '09:30')!;

		expect(short.disabled).toBe(true);
		expect(short.label).toContain('too short');
		expect(short.label).not.toContain('booked');
	});

	it('leaves a genuinely bookable slot selectable', async () => {
		const options: Option[] = await getReservationStartTimes('2026-09-09');

		expect(options.filter((o) => !o.disabled).map((o) => o.value)).toEqual([
			'09:00',
			'11:00',
			'11:30'
		]);
	});
});
