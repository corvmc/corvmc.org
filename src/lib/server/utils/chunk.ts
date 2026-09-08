/**
 * Splitting rows for D1's bound-parameter ceiling.
 *
 * D1 caps one statement at 100 bound parameters, so a multi-row insert has to
 * be split by *column count* rather than by a round number: the same 100-value
 * budget buys 25 four-column rows or 11 nine-column ones. Every caller that got
 * this wrong found out at the size where a list stops being a test fixture.
 *
 * Both functions lived twice, once in `duty-list-service` and once in
 * `acquisition-service`, which is one copy more than a rule this sharp should
 * have.
 */

/** How many rows of `columns` columns fit in one D1 statement. */
export function chunkSize(columns: number): number {
	return Math.floor(100 / columns);
}

/** Split `rows` into groups of at most `size`. */
export function chunk<T>(rows: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
	return out;
}
