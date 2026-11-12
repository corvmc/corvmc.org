import { readFileSync, globSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { migratedSqlite } from '#lib/server/testing/migrated-sqlite.js';

/** The #2565 backfill: who already knows the room keeps the 1-hour notice. */

const [migration] = globSync('migrations/*_practice_space_clearance/migration.sql');

type Sqlite = ReturnType<typeof migratedSqlite>['sqlite'];

function apply(sqlite: Sqlite) {
	for (const statement of readFileSync(migration, 'utf8').split('--> statement-breakpoint')) {
		sqlite.exec(statement);
	}
}

function holders(sqlite: Sqlite): string[] {
	const rows = sqlite
		.prepare(
			`select user_id from member_certification where certification_id = 'practice-space' order by user_id`
		)
		.all() as { user_id: string }[];
	return rows.map((r) => r.user_id);
}

function seeded(): Sqlite {
	const { sqlite } = migratedSqlite({ through: 'signups_and_hours_name_shifts' });
	const users = [
		'u-booked',
		'u-band',
		'u-staffheld',
		'u-cancelled',
		'u-oriented',
		'u-waived',
		'u-none'
	];
	sqlite.exec(
		`insert into user (id, name, email) values ${users.map((u) => `('${u}', '${u}', '${u}@x.test')`).join(', ')}`
	);
	const res = (id: string, type: string, by: string, status: string, staff: string | null) =>
		`('${id}', '${type}', '${by}', '${by}', ${staff ? `'${staff}'` : 'null'}, '${status}', 1000, 2000)`;
	sqlite.exec(`
		insert into reservation (id, booker_type, booker_id, created_by_user_id, created_by_staff_id, status, starts_at, ends_at) values
			${res('r1', 'user', 'u-booked', 'completed', null)},
			${res('r2', 'user', 'u-booked', 'completed', null)},
			${res('r3', 'group', 'u-band', 'completed', null)},
			${res('r4', 'user', 'u-staffheld', 'completed', 'u-none')},
			${res('r5', 'user', 'u-cancelled', 'cancelled', null)};
		insert into member_orientation (id, user_id, completed_at) values ('mo-1', 'u-oriented', 1500);
		insert into member_orientation (id, user_id, waived_at, waived_reason)
			values ('mo-2', 'u-waived', 1500, 'Knows the room');
	`);
	return sqlite;
}

// One replay for the file: it is the slow part, and the cases read in order.
const sqlite = seeded();
apply(sqlite);

describe('practice_space_clearance backfill', () => {
	it('adds the catalog row under the id the code reads', () => {
		const row = sqlite
			.prepare(
				`select name, validity_months from volunteer_certification where id = 'practice-space'`
			)
			.get();
		expect(row).toEqual({ name: 'Practice space', validity_months: null });
	});

	it('grants it once to own finished bookers and to oriented or waived members', () => {
		expect(holders(sqlite)).toEqual(['u-booked', 'u-oriented', 'u-waived']);
	});

	it('adds nothing on a second run', () => {
		apply(sqlite);
		expect(holders(sqlite)).toHaveLength(3);
	});
});
