import { describe, it, expect } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { accountSchema } from 'better-auth/db';
import { account } from './db/schema/authentication';

// A required account field better-auth grows that our table lacks makes credential
// sign-in answer "User not found", the same message an unknown email gets (#272).
// This names the missing column on the bump instead. No DB, like
// auth.additional-fields.spec.
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

	// 1.7.0-1.7.2 required `issuer`; 1.7.3 reverted to (providerId, accountId) (#1164).
	it('does not expect an issuer field', () => {
		expect(Object.keys(accountSchema.shape)).not.toContain('issuer');
	});
});
