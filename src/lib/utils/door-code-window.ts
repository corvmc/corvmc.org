/**
 * When a door code opens the door. Client-safe: every surface that shows a
 * code, and the lock client that programs one, read the window from here.
 */

/** How long after a reservation ends the door code keeps working. */
export const LOCK_GRACE_MINUTES = 30;

const GRACE_MS = LOCK_GRACE_MINUTES * 60_000;

export type DoorCodePhase = 'before' | 'open' | 'over';

export interface DoorCodeWindow {
	opensAt: Date;
	closesAt: Date;
	phase: DoorCodePhase;
}

/**
 * `own` is the reservation's code: the lock user opens at the start time and
 * closes the grace period after the end. `fallback` is the break-glass code,
 * shown from the grace period before the start.
 */
export function doorCodeWindow(
	r: { startsAt: Date; endsAt: Date },
	kind: 'own' | 'fallback' = 'own',
	now: Date = new Date()
): DoorCodeWindow {
	const opensAt = new Date(r.startsAt.getTime() - (kind === 'fallback' ? GRACE_MS : 0));
	const closesAt = new Date(r.endsAt.getTime() + GRACE_MS);
	const t = now.getTime();
	const phase = t < opensAt.getTime() ? 'before' : t > closesAt.getTime() ? 'over' : 'open';
	return { opensAt, closesAt, phase };
}
