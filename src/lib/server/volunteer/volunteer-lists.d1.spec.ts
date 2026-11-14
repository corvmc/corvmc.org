import { describe, it, expect, vi, beforeEach } from 'vitest';

/** The volunteers index and the hours-by-role report, against a real SQLite: both answers are joins. */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const { listVolunteers } = await import('./volunteer-profile-service');
const { getHoursByRole } = await import('./volunteer-report-service');

beforeEach(() => {
	for (const table of [
		'volunteer_hour_log',
		'volunteer_role_interest',
		'volunteer_profile',
		'volunteer_role',
		'user'
	]) {
		sqlite.exec(`delete from ${table}`);
	}
	sqlite.exec(
		`insert into user (id, name, email, email_verified, created_at, updated_at) values
			('ada', 'Ada', 'ada@example.com', 1, 1, 1),
			('minor', 'Minor', 'minor@example.com', 1, 1, 1)`
	);
	sqlite.exec(
		`insert into volunteer_role (id, name, is_active) values
			('door', 'Door', 1),
			('zine', 'Zine', 0)`
	);
	// A blocked minor never reaches the interests step, so has no interest rows.
	sqlite.exec(
		`insert into volunteer_profile (id, user_id, first_name, last_name, is_adult, status) values
			('p-ada', 'ada', 'Ada', 'L', 1, 'active'),
			('p-minor', 'minor', 'Minor', 'M', 0, 'blocked')`
	);
	sqlite.exec(
		`insert into volunteer_role_interest (id, user_id, volunteer_role_id) values ('i1', 'ada', 'door')`
	);
});

describe('listVolunteers', () => {
	it('lists a volunteer who picked no role beside one who did', async () => {
		const { rows } = await listVolunteers({});

		expect(rows.map((r) => [r.userId, r.status, r.roleNames])).toEqual([
			['ada', 'active', ['Door']],
			['minor', 'blocked', []]
		]);
	});
});

describe('getHoursByRole', () => {
	it('counts approved hours logged under a role that has since been archived', async () => {
		sqlite.exec(
			`insert into volunteer_hour_log
				(id, user_id, volunteer_role_id, worked_on, minutes, description, status) values
				('h1', 'ada', 'zine', 1, 90, 'Folded zines', 'approved'),
				('h2', 'ada', 'zine', 1, 30, 'Not yet reviewed', 'pending')`
		);

		const rows = await getHoursByRole();

		expect(rows).toMatchObject([
			{ volunteerRoleId: 'zine', roleIsActive: false, minutes: 90, logCount: 1 }
		]);
	});
});
