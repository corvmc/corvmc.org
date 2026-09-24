import { domainEvents } from '$lib/server/event-bus/event-bus';
import { resolveFlagsOnCompletion } from './work-request-service';

/** What a report closed by the clock says, where staff would have written a note. */
export const SCHEDULED_WORK_CLOSE_NOTE = 'Closed when the scheduled work finished.';

/**
 * A scheduled work order completes by the clock, never through `resolveWorkOrder`.
 * Its reports close here only when staff flagged it "close reports on completion";
 * unflagged, it waits on the Today worklist (#1544). One event per signup; the
 * second finds nothing pending. Never throws: emittery runs listeners together.
 */
export function registerWorkRequestListeners(): void {
	domainEvents.on('volunteer.shift_completed', async ({ data: event }) => {
		try {
			await resolveFlagsOnCompletion(event.shiftId, event.userId, SCHEDULED_WORK_CLOSE_NOTE);
		} catch (err) {
			console.error('[work-request] failed to close reports for finished work', err);
		}
	});
}
