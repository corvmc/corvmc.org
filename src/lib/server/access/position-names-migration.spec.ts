/**
 * The #3093 rename: Operations seat names move to sentence case. A seat still
 * holding its seeded name follows `positionLabels`; one staff renamed stays.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, globSync } from 'node:fs';
import { migratedSqlite } from '#lib/server/testing/migrated-sqlite.js';
import { operationsPositionRows } from './operations-rows';

const rename = readFileSync(
	globSync('migrations/*_position_names_sentence_case/migration.sql')[0],
	'utf8'
);

type Sqlite = ReturnType<typeof migratedSqlite>['sqlite'];

const names = (sqlite: Sqlite) =>
	Object.fromEntries(
		(
			sqlite.prepare(`select id, name from group_position where group_id = 'operations'`).all() as {
				id: string;
				name: string;
			}[]
		).map((r) => [r.id, r.name])
	);

const expected = () => Object.fromEntries(operationsPositionRows().map((r) => [r.id, r.name]));

describe('position names migration', () => {
	it('leaves every seat named as the seed names it', () => {
		expect(names(migratedSqlite().sqlite)).toEqual(expected());
	});

	it('renames seeded names, keeps an edited one, and runs twice to the same rows', () => {
		const { sqlite } = migratedSqlite({ through: 'operations_seats' });
		sqlite.exec(
			`update group_position set name = 'Moderator' where id = 'operations-site_moderator'`
		);
		sqlite.exec(rename);
		const once = names(sqlite);
		sqlite.exec(rename);

		expect(names(sqlite)).toEqual(once);
		expect(once).toEqual({ ...expected(), 'operations-site_moderator': 'Moderator' });
	});
});
