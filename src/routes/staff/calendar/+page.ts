import { redirect } from '@sveltejs/kit';

/**
 * The calendar moved to `/staff/events`.
 *
 * It shipped at this address first, on the reasoning that Productions should
 * keep `/staff/events` because the detail route could not move. That answered
 * the wrong question: `/staff/events/[id]` is where every event ref resolves, so
 * it is the default landing point for an event from anywhere in the panel, and
 * the least-privileged view is what belongs at a default. The allocation was
 * reversed the same day.
 *
 * Kept as a redirect rather than deleted because it was live long enough to be
 * bookmarked, and — the part that outlives a bookmark — the
 * "listing awaiting review" notification stored this path on every row it wrote
 * while it was current. Those rows keep their href forever.
 */
export function load() {
	redirect(308, '/staff/events');
}
