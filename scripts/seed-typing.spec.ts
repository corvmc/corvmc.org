/**
 * The seed tree is typed, and this file plus CI is what keeps it that way.
 *
 * `scripts/` and `e2e/` were outside every typecheck the repo ran: the generated
 * `.svelte-kit/tsconfig.json` includes `src`, `test`, `tests` and the two config
 * files, and `tsconfig.json` inherits that list. Fourteen thousand lines of
 * seeders and fixtures sat in the gap, where a bad `ownerId` written to a column
 * that had been dropped, four `async` functions declared to return a bare array
 * instead of a `Promise`, and nine reads of a field `batchInsert` had erased all
 * survived without a word.
 *
 * `pnpm check:tooling` (in the `Svelte Check` job) is the real guard — it fails
 * loudly on any of that, and `scripts/coverage.spec.ts` fails if the seed tree
 * ever drops out of a typecheck project again. These tests cover the one thing
 * neither can see: the two patterns that *defeat* the compiler while still
 * compiling.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const seedDir = new URL('seed/', new URL('scripts/', root));

const seedFiles = readdirSync(seedDir)
	.filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts'))
	.map((name) => [name, readFileSync(new URL(name, seedDir), 'utf8')] as const);

describe('seed typing', () => {
	it('declares seeded row arrays from the table, not as bare records', () => {
		// `batchInsert` is generic over the drizzle table, so a row array typed
		// `Record<string, unknown>[]` opts every column name and value back out of
		// checking. `(typeof <table>.$inferInsert)[]` is the idiom.
		const offenders = seedFiles
			.filter(([, source]) => /(?:rows|Rows)\s*:\s*Record<string, unknown>\[\]/.test(source))
			.map(([name]) => name);

		expect(offenders, 'type these as `(typeof <table>.$inferInsert)[]`').toEqual([]);
	});

	it('does not cast rows past `batchInsert`', () => {
		// `rows as never[]` was how three call sites got around `table: any`. The
		// signature carries the table's type now, so a cast here means the rows are
		// genuinely wrong.
		const offenders = seedFiles
			.filter(([, source]) => /\bas never\[\]/.test(source))
			.map(([name]) => name);

		expect(offenders, 'fix the row shape instead of casting it away').toEqual([]);
	});

	it('keeps `batchInsert` generic over the table it writes to', () => {
		const source = readFileSync(new URL('db.ts', seedDir), 'utf8');
		expect(source).toMatch(/batchInsert<TTable extends SQLiteTable>/);
		expect(source).toMatch(/rows: InferInsertModel<TTable>\[\]/);
		// The return is what the database hands back, not what went in — reading
		// `.id` off a seeded row depends on it.
		expect(source).toMatch(/Promise<InferSelectModel<TTable>\[\]>/);
	});
});
