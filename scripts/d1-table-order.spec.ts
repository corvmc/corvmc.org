import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { tableOrder } from './d1-table-order.mjs';

// `tableOrder` is hand-maintained but has to stay in step with the drizzle schema:
// `e2e/reset-db.ts` derives the whole between-test wipe from it with no schema
// cross-check, so a table missing from the list gets no DELETE at all and its rows
// silently survive a reset, leaking state into the next test. These tests check the
// list against drizzle's own snapshot — the same source of truth `d1-ddl.mjs` reads.

/** Newest `migrations/<timestamp>_<name>/snapshot.json` — dir names sort chronologically. */
function latestSnapshot() {
	const dir = new URL('../migrations/', import.meta.url);
	const names = readdirSync(dir)
		.filter((n) => /^\d{14}_/.test(n))
		.sort();
	const latest = names[names.length - 1];
	return JSON.parse(readFileSync(new URL(`${latest}/snapshot.json`, dir), 'utf8'));
}

const snapshot = latestSnapshot();
const schemaTables: string[] = snapshot.ddl
	.filter((e: { entityType: string }) => e.entityType === 'tables')
	.map((e: { name: string }) => e.name)
	.filter((n: string) => !n.startsWith('sqlite_') && n !== '__drizzle_migrations');
const foreignKeys = snapshot.ddl.filter((e: { entityType: string }) => e.entityType === 'fks');

describe('d1 table order', () => {
	it('lists every table in the current schema', () => {
		expect(schemaTables.filter((t) => !tableOrder.includes(t))).toEqual([]);
	});

	it('lists no table that is absent from the schema', () => {
		expect(tableOrder.filter((t: string) => !schemaTables.includes(t))).toEqual([]);
	});

	it('has no duplicate entries', () => {
		const dupes = tableOrder.filter((t: string, i: number) => tableOrder.indexOf(t) !== i);
		expect(dupes).toEqual([]);
	});

	it('places every table after each table it references', () => {
		// Insert order is parent-first, so a child's index must exceed every parent's.
		// Self-references are order-independent and skipped.
		const violations = foreignKeys
			.filter((fk: { table: string; tableTo: string }) => fk.table !== fk.tableTo)
			.filter(
				(fk: { table: string; tableTo: string }) =>
					tableOrder.indexOf(fk.table) < tableOrder.indexOf(fk.tableTo)
			)
			.map((fk: { table: string; tableTo: string }) => `${fk.table} before ${fk.tableTo}`);
		expect(violations).toEqual([]);
	});
});
