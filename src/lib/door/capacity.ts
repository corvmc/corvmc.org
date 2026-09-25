export type CapacityNote = { level: 'info' | 'warning'; text: string };

const tickets = (n: number) => `${n} ${n === 1 ? 'ticket' : 'tickets'}`;

/**
 * What the door screen says about capacity for a sale of `quantity` (#1631).
 * `remaining` is null for an uncapped show and negative once it is oversold.
 * It only ever warns: the person at the door decides.
 */
export function capacityNote(remaining: number | null, quantity: number): CapacityNote | null {
	if (remaining === null) return null;
	const standing = remaining >= 0 ? `${tickets(remaining)} left` : '';
	const over = quantity - remaining;
	if (over <= 0) return { level: 'info', text: standing };
	const already = remaining < 0 ? `Already over capacity by ${-remaining}.` : `${standing}.`;
	return { level: 'warning', text: `${already} This sale puts the show over capacity by ${over}.` };
}
