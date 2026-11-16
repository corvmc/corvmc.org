/**
 * The #2988 data migration: a committee's free-text seat titles become
 * defined positions held by the rows that carried them. A band's title is an
 * instrument and stays. Real SQLite over the real migrations, stopped before
 * the carry so the free-text shape can exist.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, globSync } from 'node:fs';
import { migratedSqlite } from '#lib/server/testing/migrated-sqlite.js';

const carry = readFileSync(
	globSync('migrations/*_carry_committee_positions/migration.sql')[0],
	'utf8'
)
	.split('--> statement-breakpoint')
	.map((s) => s.trim())
	.filter(Boolean);

const { sqlite } = migratedSqlite({ foreignKeys: true, through: 'department_positions' });
const all = (sql: string) => sqlite.prepare(sql).all();

beforeAll(() => {
	sqlite.exec(`insert into user (id, name, email) values
		('u1', 'Ada', 'a@example.com'), ('u2', 'Bo', 'b@example.com'),
		('u3', 'Cy', 'c@example.com'), ('u4', 'Di', 'd@example.com')`);
	sqlite.exec(`insert into "group" (id, kind, name, slug) values
		('g-com', 'committee', 'Booking', 'booking'),
		('g-band', 'band', 'Plumfoot', 'plumfoot')`);
	sqlite.exec(`insert into group_member (id, group_id, user_id, role, status, position) values
		('m1', 'g-com', 'u1', 'admin', 'active', 'Treasurer'),
		('m2', 'g-com', 'u2', 'member', 'active', ' Treasurer '),
		('m3', 'g-com', 'u3', 'member', 'pending', 'Secretary'),
		('m4', 'g-com', 'u4', 'member', 'active', ''),
		('m5', 'g-band', 'u1', 'owner', 'active', 'Guitar')`);
	sqlite.exec(`insert into group_invite (id, email, token, group_id, role, position, expires_at) values
		('i1', 'x@example.com', 't1', 'g-com', 'member', 'Booker', 0),
		('i2', 'y@example.com', 't2', 'g-band', 'member', 'Drums', 0)`);
	for (const s of carry) sqlite.exec(s);
});

describe('carry committee positions', () => {
	it('makes one position per distinct trimmed title in a committee', () => {
		expect(all(`select group_id, name from group_position order by name`)).toEqual([
			{ group_id: 'g-com', name: 'Secretary' },
			{ group_id: 'g-com', name: 'Treasurer' }
		]);
	});

	it('gives each active row its position, and a pending row none', () => {
		expect(
			all(`select h.member_id, p.name from group_position_holder h
				join group_position p on p.id = h.position_id order by h.member_id`)
		).toEqual([
			{ member_id: 'm1', name: 'Treasurer' },
			{ member_id: 'm2', name: 'Treasurer' }
		]);
	});

	it('clears committee titles and keeps band ones', () => {
		expect(all(`select id, position from group_member order by id`)).toEqual([
			{ id: 'm1', position: null },
			{ id: 'm2', position: null },
			{ id: 'm3', position: null },
			{ id: 'm4', position: null },
			{ id: 'm5', position: 'Guitar' }
		]);
		expect(all(`select id, position from group_invite order by id`)).toEqual([
			{ id: 'i1', position: null },
			{ id: 'i2', position: 'Drums' }
		]);
	});
});
