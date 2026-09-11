import { reservation } from '../../src/lib/server/db/schema/reservation';
import { db } from './db';

/**
 * One room, one booking at a time — enforced across seeders.
 *
 * `hasConflict` refuses an overlap and `create()` re-checks after inserting,
 * but the seed writes rows directly and eight modules pick times without
 * knowing about each other — 30 overlapping pairs in a fresh database, which
 * the staff calendar and the wizard's greyed-out slots both read (#966).
 */
type Interval = { start: number; end: number; owner: string };

const held: Interval[] = [];

/** Between bookings, mirroring `reservation.bufferMinutes`'s default. */
const BUFFER_MS = 0;
const STEP_MS = 30 * 60 * 1000;

/** Operating hours, as `reservation.operatingHours*` defaults them. */
const OPEN_HOUR = 9;
const CLOSE_HOUR = 22;

export function resetRoom(): void {
	held.length = 0;
}

function clashes(start: number, end: number): Interval | undefined {
	return held.find((h) => start < h.end + BUFFER_MS && end > h.start - BUFFER_MS);
}

export function isRoomFree(startsAt: Date, endsAt: Date): boolean {
	return !clashes(startsAt.getTime(), endsAt.getTime());
}

/**
 * Take the room, or refuse. Cancelled and waitlisted rows must not call this:
 * `hasConflict` excludes them, so holding the room for one would make the seed
 * stricter than the app.
 */
export function claimRoom(startsAt: Date, endsAt: Date, owner = 'bulk'): boolean {
	if (!isRoomFree(startsAt, endsAt)) return false;
	held.push({ start: startsAt.getTime(), end: endsAt.getTime(), owner });
	return true;
}

/**
 * Take the room at this time, or the next free slot after it the same day.
 *
 * What the randomised seeders want: a plausible booking, not that exact hour.
 * Returns null when the day is full, which the caller should treat as "skip
 * this one" rather than as an error — a full day is a real state.
 */
export function claimRoomNear(
	startsAt: Date,
	durationHours: number,
	owner = 'bulk'
): { startsAt: Date; endsAt: Date } | null {
	const durationMs = durationHours * 60 * 60 * 1000;
	const open = new Date(startsAt);
	open.setHours(OPEN_HOUR, 0, 0, 0);
	const close = new Date(startsAt);
	close.setHours(CLOSE_HOUR, 0, 0, 0);

	const wanted = Math.max(startsAt.getTime(), open.getTime());
	const tryFrom = (from: number, until: number) => {
		for (let t = from; t + durationMs <= until; t += STEP_MS) {
			const start = new Date(t);
			const end = new Date(t + durationMs);
			if (claimRoom(start, end, owner)) return { startsAt: start, endsAt: end };
		}
		return null;
	};

	// Later first, because a booking pushed back reads like the room filling up.
	// Earlier second, because an evening that is full from 6pm on would
	// otherwise be reported as a full day with the morning standing empty.
	return tryFrom(wanted, close.getTime()) ?? tryFrom(open.getTime(), wanted);
}

/**
 * A named fixture's slot: its own time if free, the next one that day if not,
 * and its own time anyway if the day is full.
 *
 * Never null, unlike `claimRoomNear`: a persona missing its booking breaks the
 * persona, and every deep link into one is by id rather than by clock.
 * `findRoomConflicts` reports the last case rather than hiding it.
 */
export function holdRoom(
	startsAt: Date,
	endsAt: Date,
	owner = 'fixture'
): { startsAt: Date; endsAt: Date } {
	const hours = (endsAt.getTime() - startsAt.getTime()) / 3_600_000;
	const shifted = claimRoomNear(new Date(startsAt), hours, owner);
	if (shifted) return shifted;

	held.push({ start: startsAt.getTime(), end: endsAt.getTime(), owner });
	return { startsAt, endsAt };
}

/** Live overlaps left in the database, read back rather than trusted. */
export async function findRoomConflicts(): Promise<Array<{ a: string; b: string; at: Date }>> {
	const rows = await db
		.select({
			id: reservation.id,
			status: reservation.status,
			startsAt: reservation.startsAt,
			endsAt: reservation.endsAt
		})
		.from(reservation);

	const live = rows
		.filter((r) => r.status !== 'cancelled' && r.status !== 'waitlisted')
		.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

	const out: Array<{ a: string; b: string; at: Date }> = [];
	for (let i = 0; i < live.length; i++) {
		for (let j = i + 1; j < live.length; j++) {
			if (live[j].startsAt >= live[i].endsAt) break;
			if (live[j].endsAt > live[i].startsAt) {
				out.push({ a: live[i].id, b: live[j].id, at: live[j].startsAt });
			}
		}
	}
	return out;
}
