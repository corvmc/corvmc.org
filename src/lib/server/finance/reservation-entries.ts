import { recordEntry } from './financial-entry-service';

/**
 * What a reservation earned, split by how it settled.
 *
 * Two calls rather than one because a booking is routinely part credit and
 * part cash, and `settlement` is the axis a Stripe cross-check joins on — so
 * the credit half must not be summed into what cleared.
 */
export async function recordReservationCredit(params: {
	reservationId: string;
	userId: string;
	creditDiscountCents: number;
	occurredAt: Date;
}): Promise<void> {
	if (params.creditDiscountCents <= 0) return;

	await recordEntry({
		amountCents: params.creditDiscountCents,
		kind: 'earned',
		category: 'reservation',
		occurredAt: params.occurredAt,
		// The member bought these hours with their membership; no money moved now.
		settlement: 'credit',
		subjectType: 'reservation',
		subjectId: params.reservationId,
		userId: params.userId,
		description: 'Practice room — settled with credits'
	});
}

export async function recordReservationCash(params: {
	reservationId: string;
	userId: string;
	amountCents: number;
	stripePaymentRecordId: string;
	occurredAt: Date;
}): Promise<void> {
	if (params.amountCents <= 0) return;

	await recordEntry({
		amountCents: params.amountCents,
		kind: 'earned',
		category: 'reservation',
		occurredAt: params.occurredAt,
		settlement: 'cash',
		stripePaymentRecordId: params.stripePaymentRecordId,
		subjectType: 'reservation',
		subjectId: params.reservationId,
		userId: params.userId,
		description: 'Practice room — cash at the desk'
	});
}
