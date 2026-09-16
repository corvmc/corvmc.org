import { describe, it, expect } from 'vitest';
import { readFileSync, globSync } from 'node:fs';
import { is, getTableColumns, getTableName } from 'drizzle-orm';
import { SQLiteTable } from 'drizzle-orm/sqlite-core';
import * as schema from '$lib/server/db/schema';
import { financialCategories } from '$lib/config';
import { moneyColumns, manualOnlyCategories, unwrittenCategories } from './money-map';

/**
 * The forcing function: the schema is the list, so adding a money column
 * anywhere turns this red until `money-map.ts` says what it means. Why it is
 * shaped this way:
 * `docs/development/conventions.md#money-columns-declare-themselves`.
 */

/** `credit_transaction.amount` is the one money column not named `*_cents`. */
const isMoneyColumn = (name: string) => /_cents$/.test(name) || name === 'amount';

const schemaMoneyColumns = (): string[] => {
	const found: string[] = [];
	for (const value of Object.values(schema)) {
		if (!is(value, SQLiteTable)) continue;
		const table = getTableName(value);
		for (const col of Object.values(getTableColumns(value))) {
			if (isMoneyColumn(col.name)) found.push(`${table}.${col.name}`);
		}
	}
	return found.sort();
};

describe('every money column is accounted for', () => {
	it('classifies every money column in the schema', () => {
		const unclassified = schemaMoneyColumns().filter((key) => !(key in moneyColumns));

		expect(
			unclassified,
			'Add each to src/lib/server/finance/money-map.ts: `movement` + `writer` if a ' +
				'financial_entry is written, `notAccounting` with a reason if nothing moved, or ' +
				'`unaccounted` with an issue number if it moves money and no writer exists yet.'
		).toEqual([]);
	});

	it('has no entry for a column that no longer exists', () => {
		// A rename leaves a stale key that reads as coverage. `pnpm check` is
		// silent on this: the map is keyed by SQL name, not by the drizzle symbol.
		const live = new Set(schemaMoneyColumns());
		expect(Object.keys(moneyColumns).filter((key) => !live.has(key))).toEqual([]);
	});
});

describe('the map stays honest', () => {
	const entries = Object.entries(moneyColumns);

	it('names a writer that exists for every accounted column', () => {
		const missing = entries
			.filter(([, v]) => 'writer' in v)
			.filter(([, v]) => {
				try {
					readFileSync((v as { writer: string }).writer, 'utf8');
					return false;
				} catch {
					return true;
				}
			})
			.map(([k, v]) => `${k} → ${(v as { writer: string }).writer}`);

		expect(missing).toEqual([]);
	});

	it('gives every unaccounted column an issue to be found by', () => {
		const untracked = entries
			.filter(([, v]) => 'unaccounted' in v)
			.filter(([, v]) => !Number.isInteger((v as { issue: number }).issue))
			.map(([k]) => k);

		expect(untracked).toEqual([]);
	});

	it('gives every notAccounting column a reason, not an empty string', () => {
		const unexplained = entries
			.filter(([, v]) => 'notAccounting' in v)
			.filter(([, v]) => (v as { notAccounting: string }).notAccounting.trim().length < 12)
			.map(([k]) => k);

		expect(unexplained).toEqual([]);
	});
});

/**
 * The other direction.
 *
 * A column map catches money that lands in a local column. Membership revenue
 * has no column — it exists only in Stripe — so it escapes that check, which
 * is how #1172 survived. The chart of accounts is where it shows up instead.
 */
describe('every category is written or declared manual', () => {
	/** Only files that write entries: `notification.ts` has an unrelated `category`. */
	const writtenCategories = (): Set<string> => {
		const written = new Set<string>();
		for (const file of globSync('src/**/*.ts')) {
			if (file.endsWith('.spec.ts')) continue;
			const source = readFileSync(file, 'utf8');
			if (!source.includes('financial-entry-service')) continue;
			for (const match of source.matchAll(/category:\s*'([a-z_]+)'/g)) written.add(match[1]);
		}
		return written;
	};

	it('accounts for every value in financialCategories', () => {
		const written = writtenCategories();
		const orphans = financialCategories.filter(
			(c) => !written.has(c) && !(c in manualOnlyCategories) && !(c in unwrittenCategories)
		);

		expect(
			orphans,
			'A category nothing writes is a permanent zero on the annual report, which reads ' +
				'only totalsByKindAndCategory. Wire a writer; or declare it in money-map.ts as ' +
				'manualOnlyCategories with the reason it arrives outside the app, or as ' +
				'unwrittenCategories with the issue that owes it one.'
		).toEqual([]);
	});

	it('drops a declared entry once something writes it', () => {
		// Both lists are claims about the present. A writer landing without the
		// claim being withdrawn leaves a category described as missing when it
		// is not, which is how a gap register stops being read.
		const written = writtenCategories();
		const declared = [...Object.keys(manualOnlyCategories), ...Object.keys(unwrittenCategories)];
		expect(declared.filter((c) => written.has(c))).toEqual([]);
	});

	it('lists only real categories, and never the same one twice', () => {
		const real = new Set<string>(financialCategories);
		const declared = [...Object.keys(manualOnlyCategories), ...Object.keys(unwrittenCategories)];
		expect(declared.filter((c) => !real.has(c))).toEqual([]);
		expect(declared.length).toBe(new Set(declared).size);
	});

	it('gives every unwritten category an issue to be found by', () => {
		const untracked = Object.entries(unwrittenCategories)
			.filter(([, issue]) => !Number.isInteger(issue))
			.map(([c]) => c);
		expect(untracked).toEqual([]);
	});
});
