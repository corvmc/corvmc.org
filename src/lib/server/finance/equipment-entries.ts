import { listForSubject, recordEntries, type RecordEntryInput } from './financial-entry-service';
import type { EquipmentReturnedEvent } from '$lib/server/event-bus/event-bus';

/**
 * What a loan earned, split by how the member settled it (#1174).
 *
 * `equipment` was written only on the spend side — buying gear — so the report
 * could show what the collective paid for equipment and not what it earned.
 */

/**
 * Two entries, as a reservation does and for the same reason.
 *
 * A loan is routinely part credit and part cash, and `settlement` is the axis
 * a Stripe cross-check joins on, so the credit half must not be summed into
 * what cleared.
 */
export async function recordEquipmentLoanCharge(event: EquipmentReturnedEvent): Promise<void> {
	if (event.totalChargeCents <= 0) return;

	// `returnLoan` writes the row once and emits once, but a retry of the whole
	// return would charge the member again, and the ledger should not compound
	// a mistake the rest of the system is still deciding about.
	const already = await listForSubject('inventory_loan', event.loanId);
	if (already.length > 0) return;

	const base = {
		occurredAt: new Date(),
		// `settleReturn` reports the cash half to Stripe and drops the record id,
		// so there is none to carry. The loan is the key instead.
		stripePaymentRecordId: null,
		subjectType: 'inventory_loan' as const,
		subjectId: event.loanId,
		userId: event.userId,
		metadata: { daysBorrowed: event.daysBorrowed }
	};

	const entries: RecordEntryInput[] = [];

	if (event.creditsCents > 0) {
		entries.push({
			...base,
			amountCents: event.creditsCents,
			kind: 'earned',
			category: 'equipment',
			// Bought with the membership; no money moved now.
			settlement: 'credit',
			description: `${event.equipmentName} — settled with credits`
		});
	}

	if (event.cashCents > 0) {
		entries.push({
			...base,
			amountCents: event.cashCents,
			kind: 'earned',
			category: 'equipment',
			settlement: 'cash',
			description: `${event.equipmentName} — loan charge`
		});
	}

	await recordEntries(entries);
}
