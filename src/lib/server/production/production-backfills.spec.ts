/**
 * The #3272 backfills, on real SQLite over the real migrations, stopped after
 * the columns they fill: a show keeps the changeover its running order walked,
 * and billing and hospitality text moves into internal notes.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, globSync } from 'node:fs';
import { migratedSqlite } from '#lib/server/testing/migrated-sqlite.js';

const sqlOf = (name: string) =>
	readFileSync(globSync(`migrations/*_${name}/migration.sql`)[0], 'utf8')
		.split('--> statement-breakpoint')
		.map((s) => s.trim())
		.filter(Boolean);

const { sqlite } = migratedSqlite({ through: 'flawless_loners' });

const T0 = 1_750_000_000;
const insertProduction = (
	id: string,
	notes: { internal?: string; billing?: string; hospitality?: string } = {}
) => {
	sqlite.prepare("insert into project (id, name, kind) values (?, 'Show', 'production')").run(id);
	return sqlite
		.prepare(
			`insert into production (id, project_id, status, internal_notes, billing_notes, hospitality_notes, created_at, updated_at)
			 values (?, ?, 'draft', ?, ?, ?, ?, ?)`
		)
		.run(id, id, notes.internal ?? null, notes.billing ?? null, notes.hospitality ?? null, T0, T0);
};

const row = (id: string) =>
	sqlite
		.prepare('select changeover_minutes as c, internal_notes as n from production where id = ?')
		.get(id) as { c: number; n: string | null };

beforeAll(() => {
	insertProduction('bare');
	insertProduction('sets');
	insertProduction('both', {
		internal: 'Receipts in the folder.',
		billing: '60/40',
		hospitality: 'Two meals'
	});
	insertProduction('billing-only', { billing: '60/40' });
	for (const [id, order, minutes] of [
		['s1', 1, 20],
		['s2', 2, 5]
	] as const) {
		sqlite
			.prepare(
				`insert into production_slot (id, production_id, sort_order, set_length_minutes, changeover_minutes, created_at, updated_at)
				 values (?, 'sets', ?, 30, ?, ?, ?)`
			)
			.run(id, order, minutes, T0, T0);
	}
	for (const statement of sqlOf('production_changeover_backfill')) sqlite.exec(statement);
	for (const statement of sqlOf('production_notes_into_internal')) sqlite.exec(statement);
});

describe('production changeover backfill', () => {
	it("takes the first set's changeover, and 15 for a show with no sets", () => {
		expect(row('sets').c).toBe(20);
		expect(row('bare').c).toBe(15);
	});
});

describe('production notes backfill', () => {
	it('appends labelled billing and hospitality text to what internal notes already say', () => {
		expect(row('both').n).toBe('Receipts in the folder.\nBilling: 60/40\nHospitality: Two meals');
	});

	it('starts internal notes from the text when it had none, with no leading break', () => {
		expect(row('billing-only').n).toBe('Billing: 60/40');
	});

	it('leaves a show with neither note untouched', () => {
		expect(row('bare').n).toBeNull();
	});
});
