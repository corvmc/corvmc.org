import { m } from '#lib/paraglide/messages.js';
import {
	IconCheck,
	IconClock,
	IconGift,
	IconCoin,
	IconArrowBackUp,
	IconUserX,
	IconCircleX
} from '@tabler/icons-svelte';
import type { reservationPaymentState } from '#lib/utils/reservation-actions.js';

export type PaymentState = ReturnType<typeof reservationPaymentState>;

/** The word, tone and glyph a payment state is drawn with, in the table and on a card. */
export function paymentStatus(state: PaymentState): {
	label: string;
	color: string;
	icon: typeof IconCheck;
} {
	switch (state) {
		case 'no_show':
			return { label: m.staff_no_show_label(), color: 'text-error', icon: IconUserX };
		case 'refunded':
			return { label: m.staff_refunded_label(), color: 'text-error', icon: IconArrowBackUp };
		case 'cancelled':
			return { label: m.staff_cancelled_label(), color: 'text-base-content', icon: IconCircleX };
		case 'paid':
			return { label: m.staff_paid_label(), color: 'text-success', icon: IconCheck };
		case 'cash_due':
			return {
				label: m.staff_reservations_cash_due_label(),
				color: 'text-warning',
				icon: IconClock
			};
		case 'unpaid':
			return { label: m.staff_unpaid_label(), color: 'text-warning', icon: IconClock };
		case 'credits':
			return { label: m.staff_paid_with_credits_label(), color: 'text-info', icon: IconCoin };
		case 'comped':
			return { label: m.staff_comped_label(), color: 'text-info', icon: IconGift };
	}
}
