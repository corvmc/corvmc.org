import { expenseLines } from '$lib/server/production/expense-service';
import {
	listForSubject,
	recordEntries,
	reverseEntriesForSubject,
	type RecordEntryInput
} from './financial-entry-service';

/**
 * A show's costs, posted to the ledger when the night is settled (#1173).
 *
 * Its own `production` category rather than a mapping onto `contractor` and
 * `facility`: what the shows cost to put on is a line a board asks for, and
 * splitting it across three buries it. The cost sheet's own category rides in
 * metadata, so the finer distinction is still collected.
 */

/**
 * Posted at settlement, not when a producer types the line.
 *
 * `occurredAt` means when the money moved, and a cost sheet is a worksheet
 * until the night is settled — lines get revised and deleted while a show is
 * being worked. Settlement is when the collective commits to the number, so
 * that is the honest date and the honest moment to write a fact.
 */
export async function postProductionExpenses(productionId: string, eventId: string): Promise<void> {
	const lines = await expenseLines(productionId);
	if (lines.length === 0) return;

	const occurredAt = new Date();
	const entries: RecordEntryInput[] = [];

	for (const line of lines) {
		if (line.amountCents <= 0) continue;
		// Per line rather than per production, so a line removed after settlement
		// reverses on its own and a line added between `settled` and `closed` is
		// picked up by the next transition rather than skipped as already posted.
		const already = await listForSubject('production_expense', line.id);
		if (already.length > 0) continue;

		entries.push({
			amountCents: -line.amountCents,
			kind: 'spent',
			category: 'production',
			occurredAt,
			// Cash or a transfer out of the till. A show cost never touches Stripe,
			// which is the whole reason the ledger has to hold it.
			settlement: 'cash',
			subjectType: 'production_expense',
			subjectId: line.id,
			// The show's group, so what a night cost and what it took net together.
			// `getSettlement` still reads `production_expense` for its own figure
			// and never these rows, so nothing is counted twice (#1170).
			settlementGroup: eventId,
			description: line.paidTo ? `${line.label} — ${line.paidTo}` : line.label,
			metadata: { productionId, category: line.category, deductible: line.deductible }
		});
	}

	await recordEntries(entries);
}

/** A line removed after the night was settled is a reversing entry, not a gap. */
export async function reverseProductionExpense(expenseId: string): Promise<void> {
	await reverseEntriesForSubject('production_expense', expenseId);
}
