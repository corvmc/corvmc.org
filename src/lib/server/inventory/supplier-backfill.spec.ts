/**
 * The #2622 backfill: `purchase_order.supplier_name` becomes an organization
 * holding `supplier`. Real SQLite over the real migrations, stopped before the
 * migration that adds `organization_id` so the free-text column still exists.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, globSync } from 'node:fs';
import { migratedSqlite } from '#lib/server/testing/migrated-sqlite.js';

const files = globSync('migrations/*/migration.sql').sort();
const at = files.findIndex((f) =>
	readFileSync(f, 'utf8').includes('ALTER TABLE `purchase_order` ADD `organization_id`')
);
const folder = (f: string) => f.split('/')[1].replace(/^\d+_/, '');
const statements = readFileSync(files[at], 'utf8')
	.split('--> statement-breakpoint')
	.map((s) => s.trim())
	.filter(Boolean);

const { sqlite } = migratedSqlite({ foreignKeys: true, through: folder(files[at - 1]) });

describe('supplier backfill', () => {
	it('makes one supplier per name, ignoring case and spaces, and reuses one on file', () => {
		sqlite.exec(`
			insert into organization (id, name) values ('shop', 'Guitar Shop');
			insert into party_role (id, organization_id, role) values ('r1', 'shop', 'sponsor');
			insert into purchase_order (id, status, supplier_name) values
				('a', 'placed', 'Sweetwater'),
				('b', 'placed', ' sweetwater '),
				('c', 'draft', 'guitar shop'),
				('d', 'draft', NULL),
				('e', 'draft', '  ');
		`);
		for (const s of statements) sqlite.exec(s);

		const orders = sqlite
			.prepare(
				`select p.id, o.name from purchase_order p left join organization o on o.id = p.organization_id order by p.id`
			)
			.all();
		expect(orders).toEqual([
			{ id: 'a', name: 'Sweetwater' },
			{ id: 'b', name: 'Sweetwater' },
			{ id: 'c', name: 'Guitar Shop' },
			{ id: 'd', name: null },
			{ id: 'e', name: null }
		]);
		const roles = sqlite
			.prepare(
				`select o.name, group_concat(r.role) as roles from organization o join party_role r on r.organization_id = o.id group by o.id order by o.name`
			)
			.all();
		expect(roles).toEqual([
			{
				name: 'Guitar Shop',
				roles: expect.stringMatching(/^(sponsor,supplier|supplier,sponsor)$/)
			},
			{ name: 'Sweetwater', roles: 'supplier' }
		]);
	});
});
