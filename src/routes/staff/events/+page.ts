import { redirect } from '@sveltejs/kit';

/**
 * The review queue moved to `/staff/calendar`.
 *
 * `/staff/events` used to hold every source and toggle between "All events" and
 * "Needs review"; it is now Productions, and reads CMC's own shows only. Staff
 * bookmark these panels, and the "listing awaiting review" notification linked
 * here with `?status=pending_review` for as long as that tab existed — so both
 * of those land on the queue rather than on an empty CMC filter.
 *
 * `status=pending_review` is the only status worth forwarding: no CMC show is
 * ever in review, so the filter would return nothing here.
 */
export function load({ url }) {
	const status = url.searchParams.get('status');
	const source = url.searchParams.get('source');

	if (status === 'pending_review' || source === 'band' || source === 'community') {
		redirect(308, '/staff/calendar');
	}
}
