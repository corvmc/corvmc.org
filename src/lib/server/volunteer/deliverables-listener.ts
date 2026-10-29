import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { dutyList } from '$lib/server/db/schema/volunteer';
import { eventListing } from '$lib/server/db/schema/event';
import { production } from '$lib/server/db/schema/production';
import { domainEvents } from '$lib/server/event-bus/event-bus';
import { captureException } from '$lib/server/sentry';
import { applyDutyList, DutyListAlreadyAppliedError } from './duty-list-service';

/**
 * A new show gets its committee deliverables (#1701): the project template
 * whose `auto_apply_on` is `production.created`, stamped into the show's
 * project and timed from this show. Found by that trigger rather than by name,
 * so staff can rename or re-own it freely. No such template, no deliverables.
 */
export function registerDeliverablesListeners(): void {
	domainEvents.on('production.created', async ({ data: event }) => {
		try {
			await applyShowDeliverables(event.eventId, event.createdByUserId);
		} catch (err) {
			captureException(err, { event: 'deliverables.apply', eventId: event.eventId });
		}
	});
}

/**
 * Stamp the default template into one show's project. It passes no reason, so
 * a re-delivered event, or a second show in the same project, is refused and
 * ignored.
 */
export async function applyShowDeliverables(
	eventId: string,
	createdByUserId: string | null
): Promise<string[]> {
	const [list] = await db
		.select({ id: dutyList.id })
		.from(dutyList)
		.where(
			and(
				eq(dutyList.autoApplyOn, 'production.created'),
				eq(dutyList.subject, 'project'),
				eq(dutyList.isActive, true)
			)
		)
		.limit(1);
	if (!list) return [];

	const [show] = await db
		.select({ projectId: production.projectId })
		.from(eventListing)
		.innerJoin(production, eq(production.id, eventListing.productionId))
		.where(eq(eventListing.id, eventId))
		.limit(1);
	if (!show?.projectId) return [];

	try {
		return (
			await applyDutyList(
				list.id,
				{ kind: 'project', id: show.projectId, eventId },
				createdByUserId
			)
		).workOrderIds;
	} catch (err) {
		if (err instanceof DutyListAlreadyAppliedError) return [];
		throw err;
	}
}
