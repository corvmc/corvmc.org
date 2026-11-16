import { getUnresolvedCount } from '#lib/server/inbox/thread-service.js';
import { countVolunteerWorkWaiting } from '#lib/server/volunteer/volunteer-signup-service.js';
import { countReviewFeed } from '#lib/server/review/review-registry.js';

/**
 * The staff sidebar's badges. Everything waiting on a staff decision is one
 * number, the review feed's (#2623), which the dashboard's filter counts read
 * too. Each count degrades to 0 on its own, since a badge is never worth a
 * failed page.
 */
export async function countStaffQueues(capabilities: readonly string[]) {
	const [inboxUnread, volunteerPending, review] = await Promise.all([
		getUnresolvedCount().catch(() => 0),
		countVolunteerWorkWaiting().catch(() => 0),
		countReviewFeed(capabilities).catch(() => ({ total: 0 }))
	]);
	return { inboxUnread, volunteerPending, reviewWaiting: review.total };
}

export type StaffQueueCounts = Awaited<ReturnType<typeof countStaffQueues>>;
