import { describe, it, expect, vi, beforeEach } from 'vitest';

/** A sponsorship is a project (#2622), against a real SQLite with foreign keys on. */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite, withBatch } = await import('#lib/server/testing/migrated-sqlite.js');
	const handle = migratedSqlite({ foreignKeys: true });
	return { sqlite: handle.sqlite, testDb: withBatch(handle) };
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const { createSponsorship, updateSponsorship, deleteSponsorship } =
	await import('./sponsor-service');

const one = <T>(query: string, ...args: unknown[]) => sqlite.prepare(query).get(...args) as T;
const count = (table: string) => one<{ n: number }>(`select count(*) n from ${table}`).n;

beforeEach(() => {
	for (const t of [
		'work_order',
		'project_committee',
		'sponsorship',
		'project',
		'party_role',
		'organization',
		'group_capability',
		'"group"'
	]) {
		sqlite.exec(`delete from ${t}`);
	}
	sqlite.exec(`insert into organization (id, name) values ('shop', 'Guitar Shop')`);
	sqlite.exec(
		`insert into party_role (id, organization_id, role) values ('r1', 'shop', 'sponsor')`
	);
	sqlite.exec(
		`insert into "group" (id, name, slug, kind) values
			('dev', 'Development Committee', 'development-committee', 'committee')`
	);
	sqlite.exec(
		`insert into group_capability (group_id, capability) values ('dev', 'sponsor.manage')`
	);
});

const input = { organizationId: 'shop', title: 'Season sponsor', status: 'prospect' as const };

describe('a sponsorship and its project', () => {
	it('is created with a sponsorship project owned by the committee holding sponsor.manage', async () => {
		const row = await createSponsorship(input, { createdByUserId: null });
		expect(one(`select kind, name from project where id = ?`, row.projectId)).toEqual({
			kind: 'sponsorship',
			name: 'Season sponsor'
		});
		expect(one(`select group_id, role from project_committee`)).toEqual({
			group_id: 'dev',
			role: 'owner'
		});
	});

	it('keeps the project named for it', async () => {
		const row = await createSponsorship(input);
		await updateSponsorship(row.id, { title: 'Spring season', status: 'active' });
		expect(one(`select name from project where id = ?`, row.projectId)).toEqual({
			name: 'Spring season'
		});
	});

	it('takes its project and tasks when deleted', async () => {
		const row = await createSponsorship(input);
		sqlite.exec(
			`insert into work_order (id, project_id, title) values ('wo1', '${row.projectId}', 'Send the logo')`
		);
		await deleteSponsorship(row.id);
		expect([count('sponsorship'), count('project'), count('work_order')]).toEqual([0, 0, 0]);
	});
});
