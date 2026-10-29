import { getUnresolvedCount } from '$lib/server/inbox/thread-service';
import { countVolunteerWorkWaiting } from '$lib/server/volunteer/volunteer-signup-service';
import { countPendingSubmissions } from '$lib/server/event/community-event-service';
import { countPendingTips } from '$lib/server/local-resource/local-resource-service';
import { countPendingAppeals } from '$lib/server/moderation/appeal-service';
import {
	countAwaitingModeration,
	countAwaitingResponse,
	countPendingEdits
} from '$lib/server/suggestion/suggestion-service';

/**
 * The staff panel's queue counts: the sidebar badges and the dashboard's Pending
 * Queues read this one function, so the number and the rows cannot disagree.
 * Each count degrades to 0 on its own, since a badge is never worth a failed page.
 */
export async function countStaffQueues() {
	const [
		inboxUnread,
		volunteerPending,
		listingsPending,
		suggestionsAwaiting,
		appealsPending,
		resourceTipsPending
	] = await Promise.all([
		getUnresolvedCount().catch(() => 0),
		// Everything waiting on a coordinator, not just hour logs
		// (docs/reports/volunteer-workflow-findings.md#d1).
		countVolunteerWorkWaiting().catch(() => 0),
		countPendingSubmissions().catch(() => 0),
		// Moderation leads: everything in it is invisible to members while it waits.
		Promise.all([countAwaitingModeration(), countAwaitingResponse(), countPendingEdits()])
			.then(([m, r, e]) => m + r + e)
			.catch(() => 0),
		// Appeals, not reports: an appeal is someone waiting on an answer they were promised.
		countPendingAppeals().catch(() => 0),
		countPendingTips().catch(() => 0)
	]);
	return {
		inboxUnread,
		volunteerPending,
		listingsPending,
		suggestionsAwaiting,
		appealsPending,
		resourceTipsPending
	};
}

export type StaffQueueCounts = Awaited<ReturnType<typeof countStaffQueues>>;
