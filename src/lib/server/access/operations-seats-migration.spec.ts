/**
 * The #2992 data migration: every job held through `model_has_roles` becomes
 * an Operations seat, `admin` stays a role row, and nobody loses a position.
 * Real SQLite over the real migrations, stopped before the carry.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, globSync } from 'node:fs';
import { migratedSqlite } from '#lib/server/testing/migrated-sqlite.js';
import { jobs, OPERATIONS_GROUP_ID } from '#lib/config.js';
import { operationsPositionRows } from './operations-rows';

const carry = readFileSync(globSync('migrations/*_operations_seats/migration.sql')[0], 'utf8')
	.split('--> statement-breakpoint')
	.map((s) => s.trim())
	.filter(Boolean);

const { sqlite } = migratedSqlite({ foreignKeys: true, through: 'operations_job' });
const all = (sql: string) => sqlite.prepare(sql).all();

/** Every (user, position) pair, from either source. */
const held = () =>
	all(`select m.user_id as user, r.name as position from model_has_roles m
			join roles r on r.id = m.role_id where r.name = 'admin'
		union all
		select gm.user_id, gp.job from group_position_holder h
			join group_position gp on gp.id = h.position_id
			join group_member gm on gm.id = h.member_id
			where gp.group_id = 'operations' and gm.status = 'active'
		order by 1, 2`);

beforeAll(() => {
	sqlite.exec(`insert into user (id, name, email) values
		('u-admin', 'Ada', 'a@example.com'), ('u-staff', 'Bo', 'b@example.com'),
		('u-both', 'Cy', 'c@example.com'), ('u-member', 'Di', 'd@example.com')`);
	sqlite.exec(`insert into roles (id, name) values
		(1, 'admin'), (2, 'staff'), (3, 'treasurer'), (4, 'member'), (5, 'sustaining member')`);
	sqlite.exec(`insert into model_has_roles (role_id, user_id) values
		(1, 'u-admin'), (4, 'u-admin'),
		(2, 'u-staff'), (5, 'u-staff'),
		(1, 'u-both'), (2, 'u-both'), (3, 'u-both'),
		(4, 'u-member')`);
	for (const s of carry) sqlite.exec(s);
});

describe('operations seats migration', () => {
	it('creates the Operations committee with the seed’s positions, one per job', () => {
		expect(all(`select id, kind, slug from "group" where id = 'operations'`)).toEqual([
			{ id: OPERATIONS_GROUP_ID, kind: 'committee', slug: 'operations' }
		]);
		expect(all(`select group_id from directory_entry where id = 'operations'`)).toHaveLength(1);
		const rows = all(`select id, group_id as groupId, name, is_chair as isChair, job
			from group_position where group_id = 'operations' order by id`);
		const expected = operationsPositionRows()
			.map((r) => ({ ...r, isChair: r.isChair ? 1 : 0 }))
			.sort((a, b) => a.id.localeCompare(b.id));
		expect(rows).toEqual(expected);
		expect(rows.map((r) => (r as { job: string }).job).sort()).toEqual([...jobs].sort());
	});

	it('keeps every position each person held', () => {
		expect(held()).toEqual([
			{ user: 'u-admin', position: 'admin' },
			{ user: 'u-both', position: 'admin' },
			{ user: 'u-both', position: 'staff' },
			{ user: 'u-both', position: 'treasurer' },
			{ user: 'u-staff', position: 'staff' }
		]);
	});

	it('removes the job role rows and keeps admin and the legacy ones', () => {
		expect(all(`select name from roles order by id`)).toEqual([
			{ name: 'admin' },
			{ name: 'member' },
			{ name: 'sustaining member' }
		]);
		expect(all(`select role_id, user_id from model_has_roles order by user_id, role_id`)).toEqual([
			{ role_id: 1, user_id: 'u-admin' },
			{ role_id: 4, user_id: 'u-admin' },
			{ role_id: 1, user_id: 'u-both' },
			{ role_id: 4, user_id: 'u-member' },
			{ role_id: 5, user_id: 'u-staff' }
		]);
	});

	it('seats each job holder once, as an active member', () => {
		expect(
			all(`select user_id, role, status from group_member
				where group_id = 'operations' order by user_id`)
		).toEqual([
			{ user_id: 'u-both', role: 'member', status: 'active' },
			{ user_id: 'u-staff', role: 'member', status: 'active' }
		]);
	});
});
