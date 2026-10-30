import { resolve } from '$app/paths';
import { withinConfirmationWindow } from '$lib/config';
import { confirmedUnpaid } from '$lib/utils/reservation-actions';
import type { NeedsYouItem } from '$lib/types/needs-you';

/** A booking the dashboard may ask the member to pay for or confirm. */
export interface ReservationNeedingYou {
	id: string;
	startsAt: Date;
	status: string;
	paidAt: Date | null;
	cashDueCents: number | null;
	bandName: string | null;
	/** Live figure: the member's usable free hours cover it right now. */
	coveredByFreeHours: boolean;
}

/**
 * Nothing is asked before the confirmation window opens, since the member
 * cannot confirm then (#2107). A `scheduled` booking is released at its start
 * unless paid or confirmed; a confirmed one with cash owing is never released,
 * so it ranks after.
 */
export function reservationNeedsYouItems(rows: ReservationNeedingYou[], now: Date): NeedsYouItem[] {
	const items: NeedsYouItem[] = [];
	for (const r of rows) {
		if (r.startsAt <= now || !withinConfirmationWindow(r.startsAt, now)) continue;
		const pay = resolve('/member/reservations/[id]/pay', { id: r.id });
		const detail = (text: string) =>
			r.bandName ? `${r.bandName}: ${text}` : text[0].toUpperCase() + text.slice(1);

		if (r.status === 'scheduled') {
			const confirm = r.coveredByFreeHours;
			items.push({
				id: `reservation-unconfirmed:${r.id}`,
				kind: 'reservation-unconfirmed',
				title: confirm
					? 'Confirm your practice room booking'
					: 'Pay for your practice room booking',
				detail: detail(
					`the room is released if it is not ${confirm ? 'confirmed' : 'paid for'} by the start`
				),
				href: confirm ? resolve('/member/reservations') : pay,
				label: confirm ? 'Confirm' : 'Pay',
				dueAt: r.startsAt,
				rank: 0
			});
		} else if (confirmedUnpaid(r)) {
			items.push({
				id: `reservation-unpaid:${r.id}`,
				kind: 'reservation-unconfirmed',
				title: 'Pay for your practice room booking',
				detail: detail('confirmed, with a balance still owing'),
				href: pay,
				label: 'Pay',
				dueAt: r.startsAt,
				rank: 1
			});
		}
	}
	return items;
}
