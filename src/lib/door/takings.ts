/**
 * How a door ticket was paid, read from its purchase id: decision 0018 keys a
 * door sale on its purchase, so the method needs no column. Every reader of
 * the door's takings goes through this table, so a new method is a new key
 * here and a new line everywhere the takings are shown.
 */
export const doorPayments = ['card', 'cash', 'free'] as const;
export type DoorPayment = (typeof doorPayments)[number];

export const DOOR_PURCHASE_PREFIX = {
	card: 'pi_',
	cash: 'cash-',
	free: 'door-'
} as const satisfies Record<DoorPayment, string>;

/** The method a door purchase was sold under; null for an online, comp or band purchase. */
export function doorPaymentOf(purchaseId: string): DoorPayment | null {
	return doorPayments.find((p) => purchaseId.startsWith(DOOR_PURCHASE_PREFIX[p])) ?? null;
}

/** A purchase id for a door sale that never reaches Stripe. A card sale's id is its intent's. */
export function newDoorPurchaseId(payment: Exclude<DoorPayment, 'card'>): string {
	return `${DOOR_PURCHASE_PREFIX[payment]}${crypto.randomUUID()}`;
}

/** A show's door takings, by how they were paid. Free lines carry a zero gross. */
export type DoorTakings = Record<DoorPayment, { tickets: number; grossCents: number }> & {
	/** Paid gifts taken on the door phone (#2799). Beside the tickets, never in them. */
	donations: { count: number; grossCents: number };
	/** Tickets checked in for the show, however sold: what a door count is read against (#2801). */
	checkedIn: number;
};

/** Everyone the door sold a ticket to, by any method. */
export function admittedAtDoor(takings: Pick<DoorTakings, DoorPayment>): number {
	return doorPayments.reduce((n, p) => n + takings[p].tickets, 0);
}
