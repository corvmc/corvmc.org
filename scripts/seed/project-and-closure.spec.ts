import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { clubToday } from '../../src/lib/config';
import { nextDay } from '../../src/lib/server/reservation/timezone';
import { BACK_ROOM_PA_PROJECT_ID } from './ballots';
import { seedClosures } from './reservations';

const inserted = vi.hoisted(() => ({ rows: [] as { startsAt: Date; endsAt: Date }[] }));
vi.mock('./db', () => ({
	db: {
		insert: () => ({
			values: async (rows: { startsAt: Date; endsAt: Date }[]) => {
				inserted.rows = rows;
			}
		})
	}
}));

describe('the seeded project', () => {
	// The project remotes validate an id with z.uuid().
	it('has an id the project remotes accept', () => {
		expect(z.uuid().safeParse(BACK_ROOM_PA_PROJECT_ID).success).toBe(true);
	});
});

describe('the seeded closures', () => {
	const originalTz = process.env.TZ;

	beforeEach(() => vi.useFakeTimers());
	afterEach(() => {
		vi.useRealTimers();
		process.env.TZ = originalTz;
	});

	// The second case is the one a seed run on a UTC machine sees in the Pacific
	// evening: the machine's date has rolled over and the club's has not.
	it.each([
		['America/Los_Angeles', '2026-11-04T18:00:00Z'],
		['America/Los_Angeles', '2026-11-05T06:00:00Z'],
		['UTC', '2026-11-05T03:00:00Z'],
		['UTC', '2026-11-05T18:00:00Z']
	])('reach the dashboard day cards in %s at %s', async (tz, now) => {
		process.env.TZ = tz;
		vi.setSystemTime(new Date(now));

		await seedClosures();

		const today = clubToday(new Date(now));
		const days = [today, nextDay(today)];
		const touched = inserted.rows.flatMap((r) => [clubToday(r.startsAt), clubToday(r.endsAt)]);
		expect(touched.some((day) => days.includes(day))).toBe(true);
	});
});
