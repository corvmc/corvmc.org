import { describe, it, expect, vi, beforeEach } from 'vitest';

/** A lost race for a member number, against a real SQLite behind the D1 driver. */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedD1 } = await import('#lib/server/testing/migrated-d1.js');
	return migratedD1();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const { assignMemberNumber } = await import('./member-number-service');

beforeEach(() => {
	sqlite.exec('delete from user');
	sqlite.exec(
		`insert into user (id, name, email) values
			('first', 'First', 'first@example.com'), ('second', 'Second', 'second@example.com')`
	);
});

describe('assignMemberNumber', () => {
	it('gives the loser of two simultaneous signups the next number', async () => {
		// Same awaits in the same order, so both read max() before either writes.
		const numbers = await Promise.all([assignMemberNumber('first'), assignMemberNumber('second')]);
		expect(numbers.sort()).toEqual([1, 2]);
	});
});
