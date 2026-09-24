/**
 * Runs the rendered LIKE against real SQLite: SQLite has no default escape
 * character, so whether `_` and `%` match literally is the engine's call, not
 * something a mocked `like()` can show.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { sqliteTable, text, SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { containsLiteral, startsWithLiteral } from './like';

const person = sqliteTable('person', { email: text('email').notNull() });
const dialect = new SQLiteSyncDialect();
let db: DatabaseSync;

beforeAll(() => {
	db = new DatabaseSync(':memory:');
	db.exec(`CREATE TABLE person (email TEXT NOT NULL)`);
	const insert = db.prepare(`INSERT INTO person (email) VALUES (?)`);
	for (const email of [
		'jo_smith@example.com',
		'joXsmith@example.com',
		'100%@example.com',
		'a\\b@x'
	])
		insert.run(email);
});

afterAll(() => db?.close());

function matching(term: string): string[] {
	const { sql, params } = dialect.sqlToQuery(containsLiteral(person.email, term));
	const rows = db.prepare(`SELECT email FROM person WHERE ${sql}`).all(...(params as string[]));
	return rows.map((r) => String(r.email)).sort();
}

describe('containsLiteral', () => {
	it('matches an underscore literally rather than as a one-character wildcard', () => {
		expect(matching('jo_smith')).toEqual(['jo_smith@example.com']);
	});

	it('matches a percent sign literally', () => {
		expect(matching('100%')).toEqual(['100%@example.com']);
	});

	it('matches a backslash literally', () => {
		expect(matching('a\\b')).toEqual(['a\\b@x']);
	});

	it('still matches a plain substring, case-insensitively', () => {
		expect(matching('SMITH')).toEqual(['joXsmith@example.com', 'jo_smith@example.com']);
	});
});

describe('startsWithLiteral', () => {
	it('matches a prefix with an underscore literally', () => {
		const { sql, params } = dialect.sqlToQuery(startsWithLiteral(person.email, 'jo_'));
		const rows = db.prepare(`SELECT email FROM person WHERE ${sql}`).all(...(params as string[]));
		expect(rows.map((r) => String(r.email))).toEqual(['jo_smith@example.com']);
	});
});
