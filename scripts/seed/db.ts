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
const proxy = await getPlatformProxy<NonNullable<App.Platform['env']>>();
export const env = proxy.env;
export const dispose = proxy.dispose;
export const db = drizzle(env.DB);

/**
 * Insert in chunks, because **D1 caps a single statement at 100 bound
 * parameters** and a multi-row insert binds every column of every row.
 *
 * `batchSize` is not a performance knob — it is arithmetic, `columns ×
 * batchSize ≤ 100`. **It is now derived from the table**, because the caller
 * doing that sum by hand meant adding a column to a wide table silently broke
 * a seeder somewhere else: seven columns on `inbox_thread` (#1305) took
 * `seedGroupChats` from 19 × 10 to 26 × 10 and the seed died on
 * `too many SQL variables`, in a file that change never touched.
 *
 * Pass one explicitly only to go *lower* than the arithmetic allows.
 */
export async function batchInsert<TTable extends SQLiteTable>(
	table: TTable,
	rows: InferInsertModel<TTable>[],
	batchSize = Math.max(1, Math.floor(100 / Object.keys(getTableColumns(table)).length))
): Promise<InferSelectModel<TTable>[]> {
	assertRows(table, rows);

	const results: InferSelectModel<TTable>[] = [];
	for (let i = 0; i < rows.length; i += batchSize) {
		const batch = rows.slice(i, i + batchSize);
		const returned = await db.insert(table).values(batch).returning();
		results.push(...(returned as InferSelectModel<TTable>[]));
	}
	return results;
}
