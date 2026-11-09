import { resolve } from '$app/paths';
import { bookingLeadHorizon } from '#lib/config.js';
import { confirmedUnpaid } from '#lib/utils/reservation-actions.js';
import type { NeedsYouItem } from '#lib/types/needs-you.js';

/** A booking the dashboard may ask the member to pay for. */
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
 * A confirmed booking with a balance owed, asked about only once it is inside
 * `BOOKING_LEAD_DAYS` (#2107). Free hours that cover it settle it from the
 * reservations list; anything else is paid on the pay page.
 */
export function reservationNeedsYouItems(rows: ReservationNeedingYou[], now: Date): NeedsYouItem[] {
	const items: NeedsYouItem[] = [];
	for (const r of rows) {
		if (r.startsAt <= now || r.startsAt > bookingLeadHorizon(now)) continue;
		if (!confirmedUnpaid(r)) continue;
		const detail = (text: string) =>
			r.bandName ? `${r.bandName}: ${text}` : text[0].toUpperCase() + text.slice(1);
		const credits = r.coveredByFreeHours;
		items.push({
			id: `reservation-unpaid:${r.id}`,
			kind: 'reservation-unconfirmed',
			title: 'Pay for your practice room booking',
			detail: detail(
				credits ? 'your free hours cover it' : 'confirmed, with a balance still owing'
			),
			href: credits
				? resolve('/member/reservations')
				: resolve('/member/reservations/[id]/pay', { id: r.id }),
			label: credits ? 'Use free hours' : 'Pay',
			dueAt: r.startsAt,
			rank: 1
		});
	}
	return items;
}
