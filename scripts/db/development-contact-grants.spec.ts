/**
 * #2622: the Development committee reaches funders' and sponsors' people through
 * `contact.read` and `contact.manage`. The migration grants both to it alone,
 * audits the change, tolerates a database with no such committee, and changes
 * nothing when run a second time.
 */
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_FOLDER } from './migrate-local';
import { migratedTemplate } from './migrated-template';

const dir = readdirSync(MIGRATIONS_FOLDER).find((n) => n.endsWith('_development_contact_grants'));
const GRANT = readFileSync(join(MIGRATIONS_FOLDER, dir ?? 'missing', 'migration.sql'), 'utf8');

function runGrant(db: DatabaseSync) {
	for (const statement of GRANT.split('--> statement-breakpoint')) db.exec(statement);
}

const migrated = migratedTemplate();

const grantsOf = (db: DatabaseSync, id: string) =>
	(
		db
			.prepare(
				`SELECT capability AS c FROM group_capability WHERE group_id = ? ORDER BY capability`
			)
			.all(id) as Array<{ c: string }>
	).map((r) => r.c);

const audits = (db: DatabaseSync) =>
	db
		.prepare(`SELECT subject_id AS id, actor_name AS a, details AS d FROM audit_log`)
		.all() as Array<{ id: string; a: string; d: string }>;

describe('development contact grants', () => {
	it('gives Development both contact capabilities beside what it had, and nobody else', () => {
		const db = migrated();
		db.exec(`
			INSERT INTO "group" (id, name, slug, kind) VALUES
				('dev', 'Development Committee', 'development-committee', 'committee'),
				('book', 'Booking Committee', 'booking-committee', 'committee'),
				('band', 'Development Committee', 'a-band-named-that', 'band');
			INSERT INTO group_capability (group_id, capability) VALUES
				('dev', 'grant.manage'),
				('dev', 'contact.read');
		`);
		runGrant(db);
		expect(grantsOf(db, 'dev')).toEqual(['contact.manage', 'contact.read', 'grant.manage']);
		expect(grantsOf(db, 'book')).toEqual([]);
		expect(grantsOf(db, 'band')).toEqual([]);

		const rows = audits(db);
		expect(rows.map((r) => r.id)).toEqual(['dev']);
		expect(rows[0].a).toBe('System');
		expect(JSON.parse(rows[0].d)).toEqual({ added: ['contact.manage'], removed: [] });

		runGrant(db);
		expect(grantsOf(db, 'dev')).toEqual(['contact.manage', 'contact.read', 'grant.manage']);
		expect(audits(db)).toHaveLength(1);
	});

	it('does nothing on a database with no Development committee', () => {
		const db = migrated();
		db.exec(`INSERT INTO "group" (id, name, slug, kind) VALUES
			('fac', 'Facility Committee', 'facility-committee', 'committee');`);
		runGrant(db);
		expect(grantsOf(db, 'fac')).toEqual([]);
		expect(audits(db)).toEqual([]);
	});
});
