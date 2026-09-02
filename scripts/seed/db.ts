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

const proxy = await getPlatformProxy();
export const env = proxy.env;
export const dispose = proxy.dispose;
export const db = drizzle(env.DB);

/**
 * Insert in chunks, because **D1 caps a single statement at 100 bound
 * parameters** and a multi-row insert binds every column of every row.
 *
 * `batchSize` is therefore not a performance knob — it is arithmetic. Pick it so
 * `columns × batchSize ≤ 100` and write the sum in a comment at the call site,
 * the way `seedDirectoryEntries` (19 × 5 = 95) and `seedVolunteerHours`
 * (13 × 7 = 91) do. The default of 10 is safe for anything up to 10 columns.
 */
export async function batchInsert<T extends Record<string, unknown>>(
	table: any,
	rows: T[],
	batchSize = 10
): Promise<T[]> {
	const results: T[] = [];
	for (let i = 0; i < rows.length; i += batchSize) {
		const batch = rows.slice(i, i + batchSize);
		const returned = await db.insert(table).values(batch).returning();
		results.push(...returned);
	}
	return results;
}
