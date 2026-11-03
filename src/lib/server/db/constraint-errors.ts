/**
 * Driver-error predicates. Kept free of schema imports so specs that mock
 * `drizzle-orm` can use the real implementations.
 */

/**
 * Matches D1/SQLite unique-violation text on the error or its wrapped cause.
 *
 * drizzle wraps the driver's "UNIQUE constraint failed: ..." in an error whose
 * own message is the SQL, so the text is in `cause` (JAVASCRIPT-SVELTEKIT-2D).
 * Duck-typed rather than `instanceof Error`: an error built in another realm,
 * such as a native driver under vitest's VM pool, fails `instanceof`.
 */
export function isUniqueConstraintError(err: unknown): boolean {
	let current = err as { message?: unknown; cause?: unknown } | null | undefined;
	for (let depth = 0; depth < 4 && typeof current?.message === 'string'; depth++) {
		if (/unique constraint/i.test(current.message)) return true;
		current = current.cause as typeof current;
	}
	return false;
}
