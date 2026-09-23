import { domainEvents } from '$lib/server/event-bus/event-bus';
import { recordAuditEntry } from './audit-service';

/**
 * Audit entries for staff actions that already surface as domain events. The
 * actor is read from the request, so a listener must run inside the emit's
 * async context, which emittery's awaited emit gives it.
 */
export function registerAuditListeners(): void {
	domainEvents.on('reservation.cancelled', async ({ data: event }) => {
		if (event.cancelledBy !== 'staff') return;
		await recordAuditEntry({
			action: 'reservation.cancelled_by_staff',
			subject: { type: 'user', id: event.userId, label: event.userName },
			details: {
				reservationId: event.reservationId,
				reason: event.reason ?? null,
				date: event.date,
				startTime: event.startTime,
				endTime: event.endTime
			}
		});
	});
}
