import { instructorStatuses, loanStatuses, localResourceStatuses } from '#lib/config.js';

/**
 * Where one action's word is shown. `status` and `filter` are the labels of a
 * status value; the other three belong to the remote form that sets it.
 */
export type ActionSurface = 'button' | 'title' | 'toast' | 'status' | 'filter';

/** One action: its word, and the catalog keys that show it on each surface. */
export type ActionWords = { word: string } & Partial<Record<ActionSurface, readonly string[]>>;

/**
 * The value sets whose every value needs a row in `actionWords`, under
 * `<set>.<value>`. `badge` means screens label the value with StatusBadge's
 * `statusLabel`, so that label must use the row's word too.
 */
export const actionStatusSets = {
	loan: { values: loanStatuses, badge: true },
	tip: { values: localResourceStatuses, badge: true },
	teacher: { values: instructorStatuses, badge: false },
	profile: { values: ['lookingForBand', 'lookingForMembers'], badge: false }
} as const;

/**
 * One action is one status value or one remote form (#2970), and it has one
 * word: every key listed against it uses that word, inflected ("return",
 * "Returned", "Mark returned"), and action-words.spec.ts checks each key. Rows for a status value are `<set>.<value>`; a form that sets no
 * value of its own (approve, resume) gets a `<set>.<verb>` row.
 */
export const actionWords = {
	'loan.requested': {
		word: 'request',
		button: ['member_equipment_request_label', 'member_equipment_submit_request_label'],
		title: ['member_equipment_request_2_title']
	},
	'loan.scheduled': {
		word: 'schedule',
		title: ['staff_inventory_loans_id_schedule_pickup_title'],
		button: ['staff_schedule_label'],
		toast: ['staff_inventory_loans_id_pickup_scheduled_toast']
	},
	'loan.checked_out': {
		word: 'check out',
		title: ['staff_inventory_loans_id_mark_as_checked_out_title'],
		button: [
			'staff_inventory_loans_id_check_out_label',
			'staff_inventory_loans_id_check_out_without_scheduling_label',
			'staff_inventory_loans_id_submit_label'
		],
		toast: ['staff_inventory_loans_id_checked_out_toast']
	},
	'loan.returned': {
		word: 'return',
		title: ['actions_mark_returned_modal_title', 'staff_inventory_loans_id_mark_as_returned_title'],
		button: ['actions_mark_returned_mark_returned_label'],
		toast: ['actions_mark_returned_success_toast']
	},
	'loan.cancelled': {
		word: 'cancel',
		button: ['actions_cancel_loan_label', 'staff_inventory_loans_id_cancel_request_label'],
		toast: ['actions_cancel_loan_success_toast']
	},

	'tip.pending': { word: 'pending', filter: ['staff_local_resources_pending_tips_label'] },
	'tip.published': {
		word: 'publish',
		button: ['staff_local_resources_id_publish_label'],
		title: ['staff_local_resources_id_publish_2_title'],
		toast: ['staff_published_toast', 'staff_local_resources_success_toast'],
		filter: ['staff_published_label']
	},
	'tip.rejected': {
		word: 'return',
		button: ['staff_return_label'],
		title: ['staff_local_resources_id_return_title'],
		toast: ['staff_returned_toast'],
		filter: ['staff_returned_label']
	},

	// The teacher roster labels its own statuses, so status and filter are keys.
	'teacher.requested': {
		word: 'pending',
		status: ['staff_pending_label'],
		filter: ['staff_members_instructors_pending_label']
	},
	'teacher.active': {
		word: 'teaching',
		status: ['staff_members_instructors_status_teaching_label']
	},
	'teacher.paused': {
		word: 'pause',
		button: ['staff_members_instructors_end_grant_actions_pause_label'],
		title: ['staff_members_instructors_end_grant_actions_pause_2_title'],
		toast: ['staff_members_instructors_end_grant_actions_paused_toast'],
		status: ['staff_members_instructors_status_paused_label']
	},
	'teacher.retired': {
		word: 'retire',
		button: ['staff_retire_label'],
		title: ['staff_members_instructors_end_grant_actions_retire_title'],
		toast: ['staff_retired_toast'],
		status: ['staff_retired_label']
	},
	'teacher.rejected': {
		word: 'return',
		button: ['staff_return_label'],
		title: ['staff_members_instructors_review_application_actions_return_title'],
		toast: ['staff_returned_toast'],
		status: ['staff_returned_label']
	},
	'teacher.approve': {
		word: 'approve',
		button: ['staff_approve_label'],
		title: ['staff_members_instructors_review_application_actions_approve_title'],
		toast: ['staff_approved_toast']
	},
	'teacher.resume': {
		word: 'resume',
		button: ['staff_members_instructors_resume_label'],
		title: ['staff_members_instructors_resume_title'],
		toast: ['staff_members_instructors_resumed_toast']
	},
	'teacher.reinstate': {
		word: 'reinstate',
		button: ['staff_members_instructors_reinstate_label'],
		title: ['staff_members_instructors_reinstate_title'],
		toast: ['staff_members_instructors_reinstated_toast']
	},

	'profile.lookingForBand': {
		word: 'looking for a band',
		title: ['member_matches_card_members_looking_band_title'],
		status: [
			'member_directory_members_id_looking_band_label',
			'public_directory_members_id_looking_band_label',
			'staff_members_id_panels_account_panel_looking_band_label',
			'directory_id_card_seeking_band_label'
		],
		filter: ['member_directory_looking_band_label']
	},
	'profile.lookingForMembers': {
		word: 'looking for members',
		title: ['member_matches_card_bands_looking_members_title'],
		status: [
			'public_directory_bands_slug_looking_members_label',
			'directory_vinyl_card_seeking_members_text'
		],
		filter: ['member_looking_members_label']
	}
} as const satisfies Record<string, ActionWords>;
