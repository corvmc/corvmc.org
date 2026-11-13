import { describe, expect, it } from 'vitest';
import {
	STAFF_TRANSITIONS,
	type StaffTransition
} from '#lib/server/instructor/instructor-transitions.js';
import { STAFF_ACTIONS, type StaffInstructorAction } from './staff-actions';

/** The service transition each control performs. */
const PERFORMS: Record<StaffInstructorAction, StaffTransition> = {
	approve: 'approve',
	sendBack: 'sendBack',
	pause: 'pause',
	retire: 'retire',
	resume: 'grant',
	reinstate: 'grant'
};

/**
 * Transitions the service allows that get no control, as `transition:status`.
 * A paused teacher had no Resume or Retire while the service allowed both (#2810).
 */
const NOT_OFFERED = new Set([
	// Handed back: the member resubmits rather than staff approving the old draft.
	'approve:rejected',
	// An application is approved, not granted around its review.
	'grant:requested',
	'grant:rejected'
]);

describe('staff teacher actions', () => {
	it('offer a control for every transition the service allows, or list it', () => {
		const missing = Object.entries(STAFF_TRANSITIONS).flatMap(([transition, from]) =>
			from
				.filter((status) => !NOT_OFFERED.has(`${transition}:${status}`))
				.filter((status) =>
					STAFF_ACTIONS[status].every((a: StaffInstructorAction) => PERFORMS[a] !== transition)
				)
				.map((status) => `${transition}:${status}`)
		);

		expect(missing).toEqual([]);
	});

	it('offer no control the service would refuse', () => {
		const refused = Object.entries(STAFF_ACTIONS).flatMap(([status, actions]) =>
			actions
				.filter(
					(a: StaffInstructorAction) =>
						!(STAFF_TRANSITIONS[PERFORMS[a]] as readonly string[]).includes(status)
				)
				.map((a: StaffInstructorAction) => `${a}:${status}`)
		);

		expect(refused).toEqual([]);
	});
});
