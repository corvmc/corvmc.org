/**
 * Whether a purchase order is late, decided once.
 *
 * "Late" is the only thing on the orders list somebody has to chase, and the
 * rule was written out on the list page alone — so the order's own page showed
 * an expected date in the past as an ordinary fact (#1064).
 */
export interface LateOrderRow {
	status: string;
	expectedAt: Date | null;
	/** True when nothing is still outstanding, however the caller counts that. */
	isComplete: boolean;
}

export function isOrderLate(order: LateOrderRow, now: Date = new Date()): boolean {
	return (
		order.status === 'placed' &&
		order.expectedAt !== null &&
		order.expectedAt < now &&
		!order.isComplete
	);
}
