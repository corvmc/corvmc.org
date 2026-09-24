import { rangeInstants, type ReportRange } from './range';
import { financialEntryKinds, type FinancialCategory, type FinancialEntryKind } from '$lib/config';

export interface CategoryLine {
	category: FinancialCategory;
	totalCents: number;
}

export interface MoneySection {
	byKind: Record<FinancialEntryKind, CategoryLine[]>;
	totalsByKind: Record<FinancialEntryKind, number>;
	/** Earned less spent. Excludes in-kind and pass-through, which are not income. */
	netCents: number;
}

/**
 * Both ends resolved, because the ledger's filter is bounded on both sides.
 *
 * An open-ended report is still a real request — "everything so far" — so the
 * ends are filled rather than refused. The far past is the epoch; the far
 * future is now, since a report cannot include what has not happened.
 */
export function ledgerWindow(range: ReportRange): { from: Date; to: Date } {
	const { from, to } = rangeInstants(range);
	return { from: from ?? new Date(0), to: to ?? new Date() };
}

function emptyByKind<T>(value: () => T): Record<FinancialEntryKind, T> {
	return Object.fromEntries(financialEntryKinds.map((k) => [k, value()])) as Record<
		FinancialEntryKind,
		T
	>;
}

/** Ledger rows folded into kinds, largest line first, with net. */
export function toMoneySection(
	entries: { kind: FinancialEntryKind; category: FinancialCategory; totalCents: number }[]
): MoneySection {
	const byKind = emptyByKind<CategoryLine[]>(() => []);
	const totalsByKind = emptyByKind<number>(() => 0);
	for (const entry of entries) {
		byKind[entry.kind].push({ category: entry.category, totalCents: entry.totalCents });
		totalsByKind[entry.kind] += entry.totalCents;
	}
	for (const kind of financialEntryKinds) {
		byKind[kind].sort((a, b) => b.totalCents - a.totalCents);
	}
	return {
		byKind,
		totalsByKind,
		// A sum, not a difference: `financialEntry.amountCents` is signed
		// ("positive into the collective, negative out"), so a `spent` total is
		// already negative and subtracting it added the spend instead (#1235).
		netCents: totalsByKind.earned + totalsByKind.spent
	};
}
