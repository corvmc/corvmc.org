import { formatMonthYear } from '$lib/utils/format';

/**
 * A reservation history cut into month sections (#904).
 *
 * A run-length pass, so input order decides section order: a newest-first
 * list yields newest-first sections. The label is the group key — "May 2026"
 * is unique per month, and it is venue time, so a late-night booking sits in
 * the month the venue was in.
 */
export function groupReservationsByMonth<T extends { startsAt: Date }>(
	rows: readonly T[]
): [string, T[]][] {
	const groups: [string, T[]][] = [];

	for (const row of rows) {
		const label = formatMonthYear(row.startsAt);
		const last = groups.at(-1);
		if (last && last[0] === label) last[1].push(row);
		else groups.push([label, [row]]);
	}

	return groups;
}
