/**
 * The one D1 connection every seeder shares, and the one insert helper they all
 * use.
 *
 * `getPlatformProxy()` is awaited at module scope, so importing this module is
 * what opens the local database. ESM evaluates it once no matter how many
 * seeders import it — but that also means **`dispose()` is the orchestrator's
 * job**, not a seeder's. `scripts/seed-dev.ts` owns the lifecycle.
 */
import { getPlatformProxy } from 'wrangler';
import { drizzle } from 'drizzle-orm/d1';
import { getTableColumns } from 'drizzle-orm';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { assertRows } from './validate';

// `src/app.d.ts` is where this project's bindings are named; without the type
// argument `env` is `unknown` and `env.DB` is unchecked.
const proxy = await getPlatformProxy<Cloudflare.Env>();
export const env = proxy.env;
export const dispose = proxy.dispose;
export const db = drizzle(env.DB);

/**
 * Insert in chunks, because **D1 caps a single statement at 100 bound
 * parameters** and a multi-row insert binds every column of every row.
 *
 * The chunk is `floor(100 / columns)`, derived from the table and not
 * accepted from the caller: a hand-sized chunk breaks when the table gains a
 * column, in a seeder the change never touched (#1305, #2592).
 */
export async function batchInsert<TTable extends SQLiteTable>(
	table: TTable,
	rows: InferInsertModel<TTable>[]
): Promise<InferSelectModel<TTable>[]> {
	assertRows(table, rows);
	const batchSize = Math.max(1, Math.floor(100 / Object.keys(getTableColumns(table)).length));

	const results: InferSelectModel<TTable>[] = [];
	for (let i = 0; i < rows.length; i += batchSize) {
		const batch = rows.slice(i, i + batchSize);
		const returned = await db.insert(table).values(batch).returning();
		results.push(...(returned as InferSelectModel<TTable>[]));
	}
	return results;
}
