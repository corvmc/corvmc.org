/**
 * When a door code opens the door. Client-safe: every surface that shows a
 * code, and the lock client that programs one, read the window from here.
 */

/** How long after a reservation ends the door code keeps working. */
export const LOCK_GRACE_MINUTES = 30;

/** How long before a reservation starts its own door code opens, for load-in. */
export const EARLY_OPEN_MINUTES = 10;

const GRACE_MS = LOCK_GRACE_MINUTES * 60_000;
const EARLY_MS = EARLY_OPEN_MINUTES * 60_000;

export type DoorCodePhase = 'before' | 'open' | 'over';

export interface DoorCodeWindow {
	opensAt: Date;
	closesAt: Date;
	phase: DoorCodePhase;
}

/**
 * `own` is the reservation's code: the lock user opens `EARLY_OPEN_MINUTES`
 * before the start and closes the grace period after the end. `fallback` is the break-glass code,
 * shown from the grace period before the start.
 */
export function doorCodeWindow(
	r: { startsAt: Date; endsAt: Date },
	kind: 'own' | 'fallback' = 'own',
	now: Date = new Date()
): DoorCodeWindow {
	const opensAt = new Date(r.startsAt.getTime() - (kind === 'fallback' ? GRACE_MS : EARLY_MS));
	const closesAt = new Date(r.endsAt.getTime() + GRACE_MS);
	const t = now.getTime();
	const phase = t < opensAt.getTime() ? 'before' : t > closesAt.getTime() ? 'over' : 'open';
	return { opensAt, closesAt, phase };
}

/**
 * When the room is booked until, ahead of `r`, if that booking runs into the
 * early-open minutes; otherwise null. `others` are live bookings of the room.
 */
export function bookedUntilBefore(
	r: { id: string; startsAt: Date },
	others: readonly { id: string; startsAt: Date; endsAt: Date }[]
): Date | null {
	const earlyFrom = r.startsAt.getTime() - EARLY_MS;
	let until: Date | null = null;
	for (const o of others) {
		if (o.id === r.id || o.startsAt >= r.startsAt || o.endsAt.getTime() <= earlyFrom) continue;
		if (!until || o.endsAt > until) until = o.endsAt;
	}
	return until;
}
