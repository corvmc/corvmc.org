/**
 * A table sort as one URL-friendly token: the column's key, with a leading `-`
 * for descending (`name`, `-activity`). `SortHeader` reads and writes it.
 */

/** How this column is sorted, as `aria-sort` names it. */
export function sortDirection(token: string, field: string): 'ascending' | 'descending' | 'none' {
	if (token === field) return 'ascending';
	if (token === `-${field}`) return 'descending';
	return 'none';
}

/**
 * The token after a click on this column: the other direction when it is
 * already the sort, else its first direction.
 */
export function nextSort(token: string, field: string, descFirst = false): string {
	const current = sortDirection(token, field);
	if (current === 'ascending') return `-${field}`;
	if (current === 'descending') return field;
	return descFirst ? `-${field}` : field;
}
