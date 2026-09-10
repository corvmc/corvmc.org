import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { NOTIFICATION_TYPES, preferenceTypesFor } from '$lib/server/db/schema/notification';

/**
 * Who a notification type is *for* is a field, not a suffix on its label.
 *
 * `getNotificationPreferences` filtered on `mandatory` and nothing else, so
 * every member's table listed nine rows labelled "(staff)" — switches for
 * notifications only a staffer can receive, inert as well as confusing because
 * each one fans out over a capability or the staff mailbox rather than over
 * subscribers (#899).
 */
/**
 * Dispatch is spread across three files: most types fan out from the listener
 * registry, the inbox's two are dispatched by the remote that assigns a thread.
 * Read all three rather than naming one, so a type that moves does not quietly
 * stop being checked.
 */
const dispatchSites = [
	'src/lib/server/notification/notification-listeners.ts',
	'src/lib/server/event-bus/register-listeners.ts',
	'src/lib/remote/inbox.remote.ts'
]
	.map((f) => readFileSync(f, 'utf8'))
	.join('\n');

describe('notification audience', () => {
	it('offers a member no switch they can never receive', () => {
		const member = preferenceTypesFor('member');

		expect(member.filter((t) => t.staffOnly)).toEqual([]);
		expect(member.length).toBeLessThan(preferenceTypesFor('staff').length);
	});

	it('offers a staffer both audiences', () => {
		const staff = preferenceTypesFor('staff').map((t) => t.key);

		expect(staff).toContain('content_flagged');
		expect(staff).toContain('reservation_reminder');
	});

	// The suffix was standing in for the field. Leaving both would let the two
	// disagree, which is how the nine got missed in the first place.
	it('carries the audience in the field rather than in the copy', () => {
		const leaked = NOTIFICATION_TYPES.filter(
			(t) => /\(staff/i.test(t.label) || /\(staff/i.test(t.description)
		);

		expect(leaked.map((t) => t.key)).toEqual([]);
	});

	// Not a pinned list for its own sake: each of these is dispatched by the
	// listeners to a capability holder or to STAFF_CONTACT_EMAIL, so marking one
	// wrongly puts a dead switch back on every member's account page.
	it('marks every type the listeners fan out over staff', () => {
		const staffOnly = NOTIFICATION_TYPES.filter((t) => t.staffOnly).map((t) => t.key);

		expect(staffOnly.sort()).toEqual(
			[
				'community_event_submitted',
				'contact_form',
				'content_flagged',
				'equipment_loan_requested',
				'event_recurring_reservation_skipped',
				'inbox_assigned',
				'inbox_message_received',
				'volunteer_hours_submitted',
				'volunteer_shift_claimed',
				'volunteer_shift_dropped'
			].sort()
		);

		for (const key of staffOnly) {
			expect(dispatchSites, `${key} is marked staff-only but nothing dispatches it`).toContain(key);
		}
	});
});
