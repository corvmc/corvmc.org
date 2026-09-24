import { domainEvents } from '$lib/server/event-bus/event-bus';
import { captureException } from '$lib/server/sentry';
import { refundMarketFees } from './vendor-fee-service';

/**
 * A cancelled market refunds every vendor fee it holds (#1502). Reports to
 * Sentry rather than throwing, since the cancellation's other listeners share
 * the emit. Payment itself is recorded among the checkout listeners.
 */
export function registerMarketListeners(): void {
	domainEvents.on('event.cancelled', async ({ data: event }) => {
		try {
			await refundMarketFees(event.eventId);
		} catch (err) {
			captureException(err);
		}
	});
}
