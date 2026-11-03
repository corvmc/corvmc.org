import { describe, it, expect } from 'vitest';
import { runInNewContext } from 'node:vm';
import { isUniqueConstraintError } from './constraint-errors';

describe('isUniqueConstraintError', () => {
	it('matches the driver text on the error or its wrapped cause', () => {
		const driver = new Error('UNIQUE constraint failed: group_member.group_id');
		expect(isUniqueConstraintError(driver)).toBe(true);
		expect(isUniqueConstraintError(new Error('insert into …', { cause: driver }))).toBe(true);
	});

	it('does not match other failures or non-errors', () => {
		expect(isUniqueConstraintError(new Error('disk on fire'))).toBe(false);
		expect(isUniqueConstraintError('UNIQUE constraint failed')).toBe(false);
		expect(isUniqueConstraintError(null)).toBe(false);
	});

	// A native driver's error under vitest's VM pool is built in another realm,
	// where `instanceof Error` is false; it went unrecognised in CI only.
	it('matches an error built in another realm', () => {
		const foreign = runInNewContext('new Error("UNIQUE constraint failed: t.c")');
		expect(foreign instanceof Error).toBe(false);
		expect(isUniqueConstraintError(foreign)).toBe(true);
	});
});
