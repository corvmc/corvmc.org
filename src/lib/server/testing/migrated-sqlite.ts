import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '#lib/server/db/schema.js';
import { relations } from '#lib/server/db/schema/relations.js';
import { D1_MAX_PARAMS } from '#lib/server/utils/chunk.js';
import { migrationImage } from './migration-image';

/**
 * An in-memory SQLite built by replaying every committed migration, behind
 * drizzle's D1 driver as production runs it. A spec that aggregates in SQL
 * needs the real schema: a mocked `db` agrees with a `WHERE` whether or not it
 * is there. Replaying is what `db:migrate:local` does, so it survives the
 * renames, rebuilds and indexes that lifting one table's `CREATE` does not (#847).
 */
export function migratedSqlite(opts: { foreignKeys?: boolean; through?: string } = {}) {
	const sqlite = new Database(replayed(opts.through));

	// After the replay, never before: a table rebuild turns this pragma back on
	// as its last statement, so setting it first is silently undone.
	sqlite.pragma(`foreign_keys = ${opts.foreignKeys ? 'ON' : 'OFF'}`);

	// The D1 driver, not better-sqlite3's: a single statement then throws
	// drizzle's `DrizzleQueryError` with the D1 error on `cause`, and `db.batch`
	// throws the D1 error bare. better-sqlite3's driver wraps neither, so a check
	// reading only `err.message` passed there and missed on D1 (#2704, #2715).
	const testDb = drizzle(d1Over(sqlite) as unknown as D1Database, { schema, relations });
	return { sqlite, testDb };
}

/** One disk read per `through` per file; each call then opens a private copy. */
const images = new Map<string | undefined, Buffer>();

function replayed(through?: string): Buffer {
	let image = images.get(through);
	if (!image) images.set(through, (image = migrationImage(through)));
	return image;
}

type Row = Record<string, unknown>;
type Result = { results: Row[]; success: true; meta: { changes: number; last_row_id: number } };

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

/** A D1 binding over better-sqlite3. `batch` runs its statements in order as one transaction. */
function d1Over(sqlite: Database.Database) {
	const execute = (sql: string, params: unknown[], raw: boolean): Result | unknown[][] => {
		try {
			// D1 caps a statement at 100 bound parameters; SQLite itself allows far more.
			if (params.length > D1_MAX_PARAMS) throw new Error('too many SQL variables');
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
