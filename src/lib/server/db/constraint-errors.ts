/**
 * Driver-error predicates, the only place driver text is matched
 * (`custom/no-driver-message-match`). Kept free of schema imports so specs that
 * mock `drizzle-orm` can use the real implementations.
 */

/**
 * Whether the error, or one it wraps, carries this driver text. On D1 a single
 * statement throws drizzle's DrizzleQueryError, whose message is the SQL, with
 * "D1_ERROR: UNIQUE constraint failed: …" on `cause`; `db.batch` throws the D1
 * error bare (JAVASCRIPT-SVELTEKIT-2D, #2704). Duck-typed, not `instanceof`:
 * a native driver's error under vitest's VM pool comes from another realm.
 */
function causeChainMatches(err: unknown, pattern: RegExp): boolean {
	let current = err as { message?: unknown; cause?: unknown } | null | undefined;
	for (let depth = 0; depth < 4 && typeof current?.message === 'string'; depth++) {
		if (pattern.test(current.message)) return true;
		current = current.cause as typeof current;
	}
	return false;
}

/** A UNIQUE or PRIMARY KEY violation. */
export function isUniqueConstraintError(err: unknown): boolean {
	return causeChainMatches(err, /unique constraint/i);
}

/** A delete or write refused by a restrict or no-action foreign key. */
export function isForeignKeyConstraintError(err: unknown): boolean {
	return causeChainMatches(err, /foreign key constraint/i);
}
