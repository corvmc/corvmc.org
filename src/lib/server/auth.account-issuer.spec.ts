import { describe, it, expect } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { accountSchema, createLocalAccountIssuer } from 'better-auth/db';
import { account } from './db/schema/authentication';

// ---------------------------------------------------------------------------
// Regression: our `account` table must carry every field better-auth requires.
//
// better-auth 1.7 added `issuer` and matches on it during credential sign-in
// (`accounts.find(a => a.providerId === 'credential' && a.issuer === ... )`).
// A missing column makes that find return undefined for every user, and the
// route answers "User not found" — the identical message an unknown email
// gets. Nothing about the failure points at a schema gap, and the only thing
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

	it('issuer defaults to the synthetic issuer better-auth matches on', () => {
		// Credential-only, so every row is the local issuer for 'credential'. The
		// default is what backfilled the rows predating the column, and what the
		// seed and e2e fixtures rely on since none of them set `issuer`.
		expect(getTableColumns(account).issuer.default).toBe(createLocalAccountIssuer('credential'));
	});
});
