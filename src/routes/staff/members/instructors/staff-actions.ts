import type { InstructorStatus } from '#lib/config.js';

/** A control staff are offered on a teacher's row and record panel. */
export type StaffInstructorAction =
	'approve' | 'sendBack' | 'pause' | 'retire' | 'resume' | 'reinstate';

/**
 * Which controls each status gets. A `Record` over every status, so a new one
 * does not compile until it is given a row; `staff-actions.spec.ts` holds it
 * to the service's transitions.
 */
export const STAFF_ACTIONS = {
	requested: ['sendBack', 'approve'],
	// Handed back: the next move is the member's resubmit.
	rejected: [],
	active: ['pause', 'retire'],
	paused: ['resume', 'retire'],
	retired: ['reinstate']
} as const satisfies Record<InstructorStatus, readonly StaffInstructorAction[]>;

export function staffActions(status: InstructorStatus): readonly StaffInstructorAction[] {
	return STAFF_ACTIONS[status];
}
