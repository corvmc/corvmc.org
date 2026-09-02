// @ts-expect-error -- plain .mjs helper, no types
import { deleteOrder } from '../d1-table-order.mjs';
import { db } from './db';
import { sql } from 'drizzle-orm';

/**
 * Empty every table, children first.
 *
 * The order — and the list — comes from `scripts/d1-table-order.mjs`, which
 * `scripts/d1-table-order.spec.ts` holds against the drizzle snapshot. This file
 * used to keep its own copy, and it drifted: `media` and `media_attachment` were
 * never added, so seeding an already-seeded database left those rows behind and
 * died on `UNIQUE constraint failed: media.key`. A table added to the schema now
 * reddens the unit suite instead of surviving a wipe.
 *
 * Tables the list names but this database lacks are skipped — see `deleteOrder`.
 */
export async function deleteAll() {
	console.log('Deleting all data...');
	const rows = await db.all<{ name: string }>(
		sql`SELECT name FROM sqlite_master WHERE type = 'table'`
	);
	const present = new Set(rows.map((row) => row.name));
	for (const table of deleteOrder(present)) {
		await db.run(sql.raw(`DELETE FROM "${table}"`));
	}
}
