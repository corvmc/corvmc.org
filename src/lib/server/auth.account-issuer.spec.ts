import { describe, it, expect } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { accountSchema } from 'better-auth/db';
import { account } from './db/schema/authentication';

// ---------------------------------------------------------------------------
// Regression: our `account` table must carry every field better-auth requires.
//
// better-auth 1.7 added `issuer` and matched on it during credential sign-in,
// so a missing column made that find return undefined for every user and the
// route answered "User not found" — the identical message an unknown email
// gets. **1.7.3 reverted that**, back to `(providerId, accountId)`, so the
// column is no longer what sign-in turns on. The file stays because the
// property it pins is the general one: a required field better-auth grows and
// we have not got is a fast failure on the bump, naming the column. Nothing about the failure points at a schema gap, and the only thing
// that caught it last time (#272) was e2e signing in for real, which took 25
// minutes of Playwright retries to say so.
//
// So pin the contract here instead: a required field better-auth grew that we
// have not got is a fast unit failure on the bump that introduces it, naming
// the column. Follows the same no-DB approach as auth.additional-fields.spec.
// ---------------------------------------------------------------------------

const columnPropertyKeys = Object.keys(getTableColumns(account));

/** A field better-auth will always read back; `.nullish()` ones parse undefined. */
function isRequired(field: { safeParse: (v: unknown) => { success: boolean } }): boolean {
	return !field.safeParse(undefined).success;
}

describe('better-auth account schema', () => {
	it('every required better-auth account field exists as a drizzle column', () => {
		for (const [key, field] of Object.entries(accountSchema.shape)) {
			if (!isRequired(field)) continue;
			expect(
				columnPropertyKeys,
				`better-auth requires account.${key}, which the drizzle account table does not declare`
			).toContain(key);
		}
	});

	/**
	 * Was: `issuer` defaults to what `createLocalAccountIssuer('credential')`
	 * returns. **better-auth reverted the scheme in 1.7.3** — "Restored
	 * compatibility with 1.6 account schemas by identifying accounts with
	 * `(providerId, accountId)` instead of issuer" — and removed the export
	 * along with it. Pinning our default against a format the library no longer
	 * uses would assert nothing, so this asserts the column still exists and
	 * still has a default, which is what the seed and the e2e fixtures rely on.
	 */
	it('issuer still carries a default, which nothing that writes an account sets', () => {
		expect(columnPropertyKeys).toContain('issuer');
		expect(getTableColumns(account).issuer.default).toBe('local:credential');
	});
});
