import type Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '#lib/server/db/schema.js';
import { relations } from '#lib/server/db/schema/relations.js';
import { migratedSqlite } from './migrated-sqlite.js';

type Row = Record<string, unknown>;
type Result = { results: Row[]; success: true; meta: { changes: number; last_row_id: number } };

/**
 * `migratedSqlite()` behind drizzle's D1 driver, so a failed write fails as it
 * does in production: a single statement throws drizzle's `DrizzleQueryError`
 * with the D1 error on `cause`, and `db.batch` throws the D1 error bare.
 * drizzle's better-sqlite3 driver wraps neither, so a check that reads only
 * `err.message` passes there and misses on D1 (#2704).
 */
export function migratedD1(opts: Parameters<typeof migratedSqlite>[0] = {}) {
	const { sqlite } = migratedSqlite(opts);
	const testDb = drizzle(d1Over(sqlite) as unknown as D1Database, { schema, relations });
	return { sqlite, testDb };
}

/** The message shape workerd gives, with SQLite's own text on `cause`. */
function d1Error(err: unknown): Error {
	const e = err as { message?: string; code?: string };
	const extended = e.code ?? 'SQLITE_ERROR';
	const base = extended.split('_').slice(0, 2).join('_');
	const inner = `${e.message}: ${base} (extended: ${extended})`;
	return new Error(`D1_ERROR: ${inner}`, { cause: new Error(inner) });
}

// D1 binds booleans; better-sqlite3 refuses them.
const bindable = (params: unknown[]) => params.map((p) => (typeof p === 'boolean' ? Number(p) : p));

function d1Over(sqlite: Database.Database) {
	const execute = (sql: string, params: unknown[], raw: boolean): Result | unknown[][] => {
		try {
			const stmt = sqlite.prepare(sql);
			const args = bindable(params);
			if (stmt.reader) {
				if (raw) return stmt.raw(true).all(...args) as unknown[][];
				return { results: stmt.all(...args) as Row[], success: true, meta: meta(0, 0) };
			}
			const r = stmt.run(...args);
			if (raw) return [];
			return { results: [], success: true, meta: meta(r.changes, Number(r.lastInsertRowid)) };
		} catch (err) {
			throw d1Error(err);
		}
	};

	class Statement {
		constructor(
			readonly sql: string,
			readonly params: unknown[] = []
		) {}
		bind(...params: unknown[]) {
			return new Statement(this.sql, params);
		}
		async run() {
			return execute(this.sql, this.params, false) as Result;
		}
		async all() {
			return execute(this.sql, this.params, false) as Result;
		}
		async raw() {
			return execute(this.sql, this.params, true) as unknown[][];
		}
		async first(column?: string) {
			const [row] = (execute(this.sql, this.params, false) as Result).results;
			if (!row) return null;
			return column ? row[column] : row;
		}
	}

	return {
		prepare: (sql: string) => new Statement(sql),
		async batch(statements: Statement[]) {
			sqlite.exec('begin');
			try {
				const out = statements.map((s) => execute(s.sql, s.params, false));
				sqlite.exec('commit');
				return out;
			} catch (err) {
				sqlite.exec('rollback');
				throw err;
			}
		}
	};
}

const meta = (changes: number, last_row_id: number) => ({ changes, last_row_id });
