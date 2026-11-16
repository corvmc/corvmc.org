/** D1 caps one statement at 100 bound parameters. */
export const D1_MAX_PARAMS = 100;

/** Split `rows` into groups of at most `size`. */
export function chunk<T>(rows: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
	return out;
}

/**
 * One multi-row insert per group of rows, each under D1's parameter cap.
 * Measured from the built statement, not counted by hand: a default such as a
 * generated id or `done: false` binds a parameter that no listed column shows.
 */
export function chunkInsert<T, Q extends { toSQL(): { params: unknown[] } }>(
	rows: T[],
	build: (group: T[]) => Q
): Q[] {
	const out: Q[] = [];
	let group: T[] = [];
	let used = 0;
	for (const row of rows) {
		const params = build([row]).toSQL().params.length;
		if (group.length > 0 && used + params > D1_MAX_PARAMS) {
			out.push(build(group));
			group = [];
			used = 0;
		}
		group.push(row);
		used += params;
	}
	if (group.length > 0) out.push(build(group));
	return out;
}
