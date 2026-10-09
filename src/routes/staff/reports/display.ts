import type { FinancialEntryKind } from '$lib/config';

/**
 * A ledger total as the page shows it. Spend is stored negative and shown under
 * a label that already says it went out, so it is negated, not `abs`ed: a net
 * refund still reads as negative spend. Net and the CSV keep the signed value.
 */
export function shownCents(kind: FinancialEntryKind, cents: number): number {
	return kind === 'spent' ? -cents : cents;
}
