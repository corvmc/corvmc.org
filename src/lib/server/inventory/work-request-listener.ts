import { domainEvents } from '$lib/server/event-bus/event-bus';
import { resolveFlagsForWorkOrder } from './work-request-service';

/** What a report closed by the clock says, where staff would have written a note. */
export const SCHEDULED_WORK_CLOSE_NOTE = 'Closed when the scheduled work finished.';

/**
 * A scheduled work order completes by the clock through `completeFinishedShifts`,
 * never through `resolveWorkOrder`, so its reports close here. One event per
 * signup; the second finds nothing pending and is a no-op. Never throws, since
 * emittery runs listeners together and a rejection would fail the others' emit.
 */
export function registerWorkRequestListeners(): void {
	domainEvents.on('volunteer.shift_completed', async ({ data: event }) => {
		try {
			await resolveFlagsForWorkOrder(event.shiftId, event.userId, SCHEDULED_WORK_CLOSE_NOTE);
		} catch (err) {
			console.error('[work-request] failed to close reports for finished work', err);
		}
	});
}
