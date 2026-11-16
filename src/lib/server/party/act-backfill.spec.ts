/**
 * The #2622 act backfill: outside acts and listings with contacts become
 * performer organizations, contacts move off `contact.entry_id`, a claimed
 * act's band points back at it, and a set's typed contact becomes a contact
 * row. Real SQLite over the real migrations, stopped before the one that adds
 * `production_slot.contact_id`, then run to the end with foreign keys on so
 * the `contact` rebuild has to keep its children.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, globSync } from 'node:fs';
import { migratedSqlite } from '#lib/server/testing/migrated-sqlite.js';

const files = globSync('migrations/*/migration.sql').sort();
const at = files.findIndex((f) =>
	readFileSync(f, 'utf8').includes('ALTER TABLE `production_slot` ADD `contact_id`')
);
const folder = (f: string) => f.split('/')[1].replace(/^\d+_/, '');
const statements = (f: string) =>
	readFileSync(f, 'utf8')
		.split('--> statement-breakpoint')
		.map((s) => s.trim())
		.filter(Boolean);

const { sqlite } = migratedSqlite({ foreignKeys: true, through: folder(files[at - 1]) });
const all = (sql: string) => sqlite.prepare(sql).all();

describe('act backfill', () => {
	it('moves acts, their people and set contacts onto organizations', () => {
		sqlite.exec(`
			insert into "group" (id, kind, name, slug) values ('g-1', 'band', 'Fenwick', 'fenwick');
			insert into directory_entry (id, name, visibility) values ('de-out', 'Sawtooth Rivals', 'hidden');
			insert into directory_entry (id, name, visibility, group_id) values ('de-claimed', 'Fenwick', 'hidden', 'g-1');
			insert into contact (id, entry_id, name, email, source) values
				('c-out', 'de-out', 'Manager', 'mgr@rivals.example', 'self_entered'),
				('c-claimed', 'de-claimed', 'Old booker', 'old@fenwick.example', 'staff_entered');
			insert into party_role (id, contact_id, role) values ('pr-c', 'c-out', 'press');
			insert into user (id, name, email, email_verified, created_at, updated_at)
				values ('u-1', 'Staff', 'staff@example.com', 0, 0, 0);
			insert into event_listing (id, title, starts_at, ends_at, status, source, kind, created_by_user_id)
				values ('ev', 'Show', 0, 1, 'draft', 'cmc', 'show', 'u-1');
			insert into event_listing (id, title, starts_at, ends_at, status, source, kind, created_by_user_id)
				values ('ev2', 'Show 2', 0, 1, 'draft', 'cmc', 'show', 'u-1'),
					('ev3', 'Show 3', 0, 1, 'draft', 'cmc', 'show', 'u-1'),
					('ev4', 'Show 4', 0, 1, 'draft', 'cmc', 'show', 'u-1');
			insert into event_band (id, event_id, name, billing_order, directory_entry_id, status) values
				('eb1', 'ev', 'Sawtooth Rivals', 1, 'de-out', 'confirmed'),
				('eb2', 'ev2', 'Sawtooth Rivals', 1, 'de-out', 'confirmed'),
				('eb3', 'ev3', 'Sawtooth Rivals', 1, 'de-out', 'confirmed'),
				('eb4', 'ev4', 'Sawtooth Rivals', 1, 'de-out', 'confirmed');
			insert into project (id, name, kind) values ('pr', 'Show', 'production');
			insert into production (id, project_id) values ('pn', 'pr');
			insert into production_slot (id, production_id, event_band_id, sort_order, set_length_minutes,
				contact_name, contact_email, contact_phone) values
				('s-known', 'pn', 'eb1', 1, 30, 'Manager', ' MGR@rivals.example ', NULL),
				('s-new', 'pn', 'eb2', 2, 30, 'Tour manager', 'tm@rivals.example', '541-555-0101'),
				('s-noemail', 'pn', 'eb3', 3, 30, 'Fill-in', NULL, '541-555-0102'),
				('s-blank', 'pn', 'eb4', 4, 30, '  ', NULL, NULL);
		`);
		// One transaction per file, as D1 runs a migration, so deferred keys hold.
		for (const f of files.slice(at)) {
			sqlite.exec('BEGIN');
			for (const s of statements(f)) sqlite.exec(s);
			sqlite.exec('COMMIT');
		}

		expect(
			all(`select o.name, o.directory_entry_id as entry, o.archived_at is not null as archived, r.role
				from organization o join party_role r on r.organization_id = o.id order by o.name`)
		).toEqual([
			{ name: 'Fenwick', entry: 'de-claimed', archived: 1, role: 'performer' },
			{ name: 'Sawtooth Rivals', entry: 'de-out', archived: 0, role: 'performer' }
		]);
		const orgOf = (entry: string) =>
			(
				sqlite.prepare(`select id from organization where directory_entry_id = ?`).get(entry) as {
					id: string;
				}
			).id;
		expect(
			all(`select id, organization_id as o from contact where id like 'c-%' order by id`)
		).toEqual([
			{ id: 'c-claimed', o: orgOf('de-claimed') },
			{ id: 'c-out', o: orgOf('de-out') }
		]);
		expect(all(`select from_organization_id as o from "group" where id = 'g-1'`)).toEqual([
			{ o: orgOf('de-claimed') }
		]);
		expect(
			all(`select s.id, c.name, c.email, c.phone, c.organization_id = '${orgOf('de-out')}' as atAct
				from production_slot s left join contact c on c.id = s.contact_id order by s.sort_order`)
		).toEqual([
			{ id: 's-known', name: 'Manager', email: 'mgr@rivals.example', phone: null, atAct: 1 },
			{
				id: 's-new',
				name: 'Tour manager',
				email: 'tm@rivals.example',
				phone: '541-555-0101',
				atAct: 1
			},
			{ id: 's-noemail', name: 'Fill-in', email: null, phone: '541-555-0102', atAct: 1 },
			{ id: 's-blank', name: null, email: null, phone: null, atAct: null }
		]);
		// The rebuild of `contact` kept the rows that cascade from it.
		expect(all(`select contact_id as c from party_role where id = 'pr-c'`)).toEqual([
			{ c: 'c-out' }
		]);
		expect(
			all(`pragma table_info(contact)`).map((c) => (c as { name: string }).name)
		).not.toContain('entry_id');
	});
});
