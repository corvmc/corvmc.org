import { reservationCancellerLabels, type ReservationCanceller } from '$lib/config';
import { formatDateTime } from './format';

export interface CancellationFacts {
	cancelledBy: ReservationCanceller | null;
	cancelledByName: string | null;
	cancelledAt: Date | null;
}

/**
 * The first sentence of a cancellation notice: who and when, e.g.
 * "Cancelled by staff (Jane Doe), Tue, Sep 3, 4:15 PM." The reason is not part
 * of it; each part a row lacks is left out rather than guessed.
 */
export function describeCancellation(facts: CancellationFacts): string {
	const { cancelledBy, cancelledByName, cancelledAt } = facts;
	let text = 'Cancelled';
	if (cancelledBy) text += ` ${reservationCancellerLabels[cancelledBy]}`;
	if (cancelledBy && cancelledBy !== 'system' && cancelledByName) text += ` (${cancelledByName})`;
	if (cancelledAt) text += `, ${formatDateTime(cancelledAt)}`;
	return `${text}.`;
}
