import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { dutyList } from '$lib/server/db/schema/volunteer';
import { domainEvents } from '$lib/server/event-bus/event-bus';
import { captureException } from '$lib/server/sentry';
import { applyDutyList, DutyListAlreadyAppliedError } from './duty-list-service';

/**
 * A new show gets its committee deliverables (#1701): the event-subject list
 * whose `auto_apply_on` is `production.created`, found by that trigger rather
 * than by name, so staff can rename or re-own it freely. No such list, no
 * deliverables, no error.
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

/** Stamp the default list onto one show. A re-delivered event is refused by name and ignored. */
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
				eq(dutyList.subject, 'event'),
				eq(dutyList.isActive, true)
			)
		)
		.limit(1);
	if (!list) return [];

	try {
		return (await applyDutyList(list.id, { kind: 'event', id: eventId }, createdByUserId))
			.workOrderIds;
	} catch (err) {
		if (err instanceof DutyListAlreadyAppliedError) return [];
		throw err;
	}
}
