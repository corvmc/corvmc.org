/**
 * A Zod check on every seeded row, derived from the drizzle table itself.
 *
 * `batchInsert` is typed against `$inferInsert`, which catches a wrong column
 * name or a wrong shape at compile time. This is the runtime half, and it earns
 * its place on the values types cannot see: a string that has to be one of an
 * enum's members, a value that arrives from `JSON.parse` or an `any`-typed
 * fixture, a row assembled through a `Record` on the way in.
 *
 * The failure it replaces is the reason it exists. D1 reports a violated
 * constraint as `UNIQUE constraint failed: media.key` — the table, and nothing
 * about *which* of the ten rows in the batch or *which* field. This names both
 * before the statement is ever sent.
 *
 * Set `SEED_SKIP_VALIDATE=1` to turn it off.
 */
import { createInsertSchema } from 'drizzle-zod';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { getTableName } from 'drizzle-orm';
import type { z } from 'zod';

export const VALIDATE = process.env.SEED_SKIP_VALIDATE !== '1';

// Building a schema walks every column, so do it once per table rather than
// once per batch — a seed inserts into the same table many times over.
const cache = new WeakMap<SQLiteTable, z.ZodType>();

function insertSchema(table: SQLiteTable): z.ZodType {
	let schema = cache.get(table);
	if (!schema) {
		schema = createInsertSchema(table) as z.ZodType;
		cache.set(table, schema);
	}
	return schema;
}

/**
 * Throw on the first row that does not match the table, naming the row's index
 * within the batch and the offending field.
 */
export function assertRows(table: SQLiteTable, rows: readonly unknown[]): void {
	if (!VALIDATE) return;

	const schema = insertSchema(table);
	for (const [i, row] of rows.entries()) {
		const result = schema.safeParse(row);
		if (result.success) continue;

		const issues = result.error.issues
			.map((issue) => `${issue.path.join('.') || '(row)'}: ${issue.message}`)
			.join('\n    ');
		throw new Error(
			`Seed row ${i} is not a valid \`${getTableName(table)}\` insert:\n    ${issues}`
		);
	}
}
