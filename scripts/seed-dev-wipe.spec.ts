/**
 * `pnpm db:seed` opens by clearing every table, which is what makes it safe to
 * run twice and what `pnpm db:reset` relies on. That guarantee was only as good
 * as a hand-written list inside `scripts/seed-dev.ts`, and the list had drifted:
 * `media` and `media_attachment` were never added to it. Foreign keys are off
 * for the whole seed (`PRAGMA foreign_keys = OFF` at the top of `main()`), so
 * nothing cascaded in to cover for the omission either — the rows simply
 * survived, and the second seed died on
 *
 *   D1_ERROR: UNIQUE constraint failed: media.key
 *
 * which names the table but gives no hint that a stale wipe is the cause.
 *
 * The fix was to delete the second list and derive the wipe from
 * `scripts/d1-table-order.mjs`, the copy that `scripts/d1-table-order.spec.ts`
 * already holds against the drizzle snapshot. These tests keep it that way:
 * a new table can no longer be added to the schema and missed here.
 *
 * `deleteAll()` now lives in `scripts/seed/teardown.ts` — the seed was split
 * one-file-per-feature and `scripts/seed-dev.ts` kept only `main()`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
// @ts-expect-error -- plain .mjs helper, no types
import { deleteOrder } from './d1-table-order.mjs';

const source = readFileSync(new URL('./seed/teardown.ts', import.meta.url), 'utf8');

/** The body of `async function deleteAll() { … }`, up to its closing brace. */
function deleteAllBody(): string {
	const start = source.indexOf('export async function deleteAll()');
	expect(start, 'seed/teardown.ts no longer defines deleteAll()').toBeGreaterThan(-1);
	const end = source.indexOf('\n}', start);
	return source.slice(start, end);
}

/** Newest `migrations/<timestamp>_<name>/snapshot.json` — dir names sort chronologically. */
function latestSnapshot() {
	const dir = new URL('../migrations/', import.meta.url);
	const names = readdirSync(dir)
		.filter((n) => /^\d{14}_/.test(n))
		.sort();
	return JSON.parse(readFileSync(new URL(`${names[names.length - 1]}/snapshot.json`, dir), 'utf8'));
}

const schemaTables: string[] = latestSnapshot()
	.ddl.filter((e: { entityType: string }) => e.entityType === 'tables')
	.map((e: { name: string }) => e.name)
	.filter((n: string) => !n.startsWith('sqlite_') && n !== '__drizzle_migrations');

describe('seed-dev wipe', () => {
	it('derives its table list from d1-table-order, not a second copy', () => {
		expect(source).toMatch(/import\s*\{[^}]*\bdeleteOrder\b[^}]*\}\s*from\s*'\.\.\/d1-table-order/);
	});

	it('hand-writes no table names in deleteAll', () => {
		// A quoted string naming a real table is the drift this replaced — the body
		// should reach tables only through `deleteOrder`. Other literals are fine:
		// the `sqlite_master` lookup legitimately quotes `'table'`.
		const literals = [...deleteAllBody().matchAll(/'([a-z][a-z0-9_]*)'/g)].map((m) => m[1]);
		const named = literals.filter((l) => schemaTables.includes(l));
		expect(named, 'move these into scripts/d1-table-order.mjs').toEqual([]);
	});

	it('clears every table the current schema defines', () => {
		const cleared: string[] = deleteOrder(new Set(schemaTables));
		expect([...cleared].sort()).toEqual([...schemaTables].sort());
	});
});
