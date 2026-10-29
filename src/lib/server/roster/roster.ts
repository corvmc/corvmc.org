import { toMemberRef, type MemberRefRow } from '$lib/server/entity/refs';
import { toCsv } from '$lib/server/report/csv';
import type { PaginationInput, PaginatedResult } from '$lib/server/db/paginate';
import { memberStatusLabels, type RosterPerson } from '$lib/types/roster';

/**
 * The row contract every roster shares, from a `memberRefColumns()` projection.
 *
 * Member status reads `sustaining` directly rather than the ref's subtype,
 * because a subtype of `staff` hides whether that staffer also pays.
 */
export function toRosterPerson(row: MemberRefRow & { id: string }): RosterPerson {
	return {
		personId: row.id,
		member: toMemberRef(row),
		email: row.email ?? null,
		memberStatus: row.sustaining ? 'sustaining' : 'member'
	};
}

/**
 * Every row of a paginated people-query, for an export or "copy emails". Walks
 * the pages rather than raising the page size, so a roster has no silent cap.
 */
export async function allRosterRows<T>(
	list: (pagination: PaginationInput) => Promise<PaginatedResult<T>>,
	pageSize = 500
): Promise<T[]> {
	const first = await list({ page: 1, pageSize });
	const rows = [...first.rows];
	for (let page = 2; page <= first.pagination.totalPages; page++) {
		rows.push(...(await list({ page, pageSize })).rows);
	}
	return rows;
}

/** A page-specific CSV column, after the shared ones. */
export interface RosterColumn<T> {
	header: string;
	value: (row: T) => string | number | null;
}

const BASE_COLUMNS = ['name', 'email', 'member_status'];

/** A roster as CSV: name, email and member status first, then the page's own columns. */
export function rosterCsv<T extends RosterPerson>(
	rows: T[],
	columns: RosterColumn<T>[] = []
): string {
	return toCsv(
		rows.map((row) => ({
			name: row.member.title,
			email: row.email ?? '',
			member_status: memberStatusLabels[row.memberStatus],
			...Object.fromEntries(columns.map((c) => [c.header, c.value(row) ?? '']))
		})),
		[...BASE_COLUMNS, ...columns.map((c) => c.header)]
	);
}

/** Distinct addresses in roster order, case-insensitively, skipping people with none. */
export function rosterEmails(rows: RosterPerson[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const { email } of rows) {
		const key = email?.trim().toLowerCase();
		if (!key || seen.has(key)) continue;
		seen.add(key);
		out.push(email!.trim());
	}
	return out;
}
