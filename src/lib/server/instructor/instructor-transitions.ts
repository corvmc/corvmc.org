import type { InstructorStatus } from '#lib/config.js';

/**
 * The states each staff transition starts from. The service scopes its writes
 * with these lists, and `src/routes/staff/members/instructors/staff-actions.ts`
 * is held by a spec to offer a control for every pair (#2810).
 */
export const STAFF_TRANSITIONS = {
	approve: ['requested', 'rejected'],
	sendBack: ['requested'],
	pause: ['active'],
	retire: ['active', 'paused'],
	// Any existing record that is not active; `grant()` also creates one.
	grant: ['requested', 'rejected', 'paused', 'retired']
} as const satisfies Record<string, readonly InstructorStatus[]>;

export type StaffTransition = keyof typeof STAFF_TRANSITIONS;
