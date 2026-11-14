/**
 * The #3009 data migration: each committee's `admin` rows become holders of
 * its chair position, and committee roles drop to `member`. A band's `owner`
 * and a club's `admin` stay. Real SQLite over the real migrations, stopped
 * before the carry so the admin-means-chair shape can exist.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, globSync } from 'node:fs';
import { migratedSqlite } from '#lib/server/testing/migrated-sqlite.js';

const carry = readFileSync(
	globSync('migrations/*_committee_chair_position/migration.sql')[0],
	'utf8'
)
	.split('--> statement-breakpoint')
	.map((s) => s.trim())
	.filter(Boolean);

const { sqlite } = migratedSqlite({ foreignKeys: true, through: 'committee_chair_flag' });
const all = (sql: string) => sqlite.prepare(sql).all();

beforeAll(() => {
	sqlite.exec(`insert into user (id, name, email) values
		('u1', 'Ada', 'a@example.com'), ('u2', 'Bo', 'b@example.com'),
		('u3', 'Cy', 'c@example.com'), ('u4', 'Di', 'd@example.com')`);
	sqlite.exec(`insert into "group" (id, kind, name, slug) values
		('g-book', 'committee', 'Booking', 'booking'),
		('g-fac', 'committee', 'Facility', 'facility'),
		('g-none', 'committee', 'Headless', 'headless'),
		('g-club', 'club', 'Choir', 'choir'),
		('g-band', 'band', 'Plumfoot', 'plumfoot')`);
	sqlite.exec(`insert into group_position (id, group_id, name) values ('p-fac', 'g-fac', 'Chair')`);
	sqlite.exec(`insert into group_member (id, group_id, user_id, role, status) values
		('m1', 'g-book', 'u1', 'admin', 'active'),
		('m2', 'g-book', 'u2', 'admin', 'active'),
		('m3', 'g-book', 'u3', 'admin', 'pending'),
		('m4', 'g-fac', 'u4', 'admin', 'active'),
		('m5', 'g-fac', 'u1', 'member', 'active'),
		('m6', 'g-club', 'u1', 'admin', 'active'),
		('m7', 'g-band', 'u2', 'owner', 'active')`);
	sqlite.exec(`insert into group_invite (id, email, token, group_id, role, expires_at) values
		('i1', 'x@example.com', 't1', 'g-book', 'admin', 0),
		('i2', 'y@example.com', 't2', 'g-club', 'admin', 0)`);
	for (const s of carry) sqlite.exec(s);
});

describe('committee chair position', () => {
	it('gives every committee one chair position, reusing one called Chair', () => {
		expect(
			all(`select group_id, name, id = 'p-fac' as reused from group_position
				where is_chair = 1 order by group_id`)
		).toEqual([
			{ group_id: 'g-book', name: 'Chair', reused: 0 },
			{ group_id: 'g-fac', name: 'Chair', reused: 1 },
			{ group_id: 'g-none', name: 'Chair', reused: 0 }
		]);
	});

	it('makes each active committee admin a holder, and a pending one none', () => {
		expect(
			all(`select h.member_id from group_position_holder h
				join group_position p on p.id = h.position_id
				where p.is_chair = 1 order by h.member_id`)
		).toEqual([{ member_id: 'm1' }, { member_id: 'm2' }, { member_id: 'm4' }]);
	});

	it('drops committee roles to member and keeps club and band ones', () => {
		expect(all(`select id, role from group_member order by id`)).toEqual([
			{ id: 'm1', role: 'member' },
			{ id: 'm2', role: 'member' },
			{ id: 'm3', role: 'member' },
			{ id: 'm4', role: 'member' },
			{ id: 'm5', role: 'member' },
			{ id: 'm6', role: 'admin' },
			{ id: 'm7', role: 'owner' }
		]);
		expect(all(`select id, role from group_invite order by id`)).toEqual([
			{ id: 'i1', role: 'member' },
			{ id: 'i2', role: 'admin' }
		]);
	});

	it('refuses a second chair position on one committee', () => {
		expect(() =>
			sqlite.exec(
				`insert into group_position (id, group_id, name, is_chair) values ('x', 'g-book', 'Co-chair', 1)`
			)
		).toThrow(/UNIQUE/);
	});
});
