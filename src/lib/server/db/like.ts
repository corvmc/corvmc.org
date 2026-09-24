import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';

/** Escape LIKE wildcards so user input is treated literally. */
export function escapeLike(input: string): string {
	return input.replace(/[%_\\]/g, (ch) => `\\${ch}`);
}

/** Wraps drizzle's escape-less `like()`, so the backslash escapes of the pattern take effect. */
export function containsLiteral(column: SQLWrapper, term: string): SQL {
	return sql`${column} like ${`%${escapeLike(term)}%`} escape '\\'`;
}

/** Prefix form of `containsLiteral`. */
export function startsWithLiteral(column: SQLWrapper, prefix: string): SQL {
	return sql`${column} like ${`${escapeLike(prefix)}%`} escape '\\'`;
}
