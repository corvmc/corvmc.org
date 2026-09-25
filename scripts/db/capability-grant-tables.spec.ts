/**
 * #1624 moves capability grants from JSON columns into join tables, expand then
 * contract. Seeds the JSON the way production holds it, on a scratch file migrated
 * to just before the tables exist, then runs every later migration and checks that
 * each grant came through as a row. Prod D1 is canonical, so the copy must be lossless.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { cpSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations, MIGRATIONS_FOLDER } from './migrate-local';

const tags = readdirSync(MIGRATIONS_FOLDER)
	.filter((n) => /^\d{14}_/.test(n))
	.sort();
const TABLES_TAG = tags.find((t) => t.endsWith('_capability_grant_tables')) ?? 'missing';
const COPY_TAG = tags.find((t) => t.endsWith('_capability_grant_copy')) ?? 'missing';
const COPY = readFileSync(join(MIGRATIONS_FOLDER, COPY_TAG, 'migration.sql'), 'utf8');

/** A migrations folder holding every migration that sorts before `tag`, or through it. */
function migrationsUntil(tag: string, inclusive: boolean): string {
	const dir = mkdtempSync(join(tmpdir(), 'corvmc-grant-migrations-'));
	for (const t of tags) {
		if (inclusive ? t <= tag : t < tag) {
			cpSync(join(MIGRATIONS_FOLDER, t), join(dir, t), { recursive: true });
		}
	}
	return dir;
}

const GROUPS: Record<string, string[]> = {
	booking: ['event.publish', 'finance.read', 'project.manage', 'volunteer.manageShifts'],
	dev: ['grant.manage', 'grant.read', 'sponsor.manage', 'sponsor.read'],
	// Off the allowlist today; copied as stored, and the resolver still ignores it.
	stale: ['user.ban'],
	idle: []
};
const ROLES: Record<string, string[]> = {
	door: ['incident.file'],
	photo: ['event.uploadRecap', 'incident.file'],
	repair: []
};

const rowsOf = (db: DatabaseSync, table: string, key: string, id: string) =>
	(
		db
			.prepare(`SELECT capability FROM ${table} WHERE ${key} = ? ORDER BY capability`)
			.all(id) as Array<{ capability: string }>
	).map((r) => r.capability);

const count = (db: DatabaseSync, table: string) =>
	(db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

describe('capability grants: JSON columns to join tables', () => {
	let file: string;
	let db: DatabaseSync;

	beforeAll(() => {
		file = join(mkdtempSync(join(tmpdir(), 'corvmc-grant-tables-')), 'd1.sqlite');
		applyMigrations(file, migrationsUntil(TABLES_TAG, false));
		const seed = new DatabaseSync(file);
		const group = seed.prepare(
			`INSERT INTO "group" (id, kind, name, slug, capability_grants) VALUES (?, 'committee', ?, ?, ?)`
		);
		for (const [id, grants] of Object.entries(GROUPS)) {
			group.run(id, id, id, JSON.stringify(grants));
		}
		const role = seed.prepare(
			`INSERT INTO volunteer_role (id, name, capability_grants) VALUES (?, ?, ?)`
		);
		for (const [id, grants] of Object.entries(ROLES)) role.run(id, id, JSON.stringify(grants));
		seed.close();

		applyMigrations(file, migrationsUntil(COPY_TAG, true));
	});

	it('copies every committee grant into group_capability', () => {
		db = new DatabaseSync(file);
		for (const [id, grants] of Object.entries(GROUPS)) {
			expect(rowsOf(db, 'group_capability', 'group_id', id), id).toEqual([...grants].sort());
		}
	});

	it('copies every role grant into volunteer_role_capability', () => {
		for (const [id, grants] of Object.entries(ROLES)) {
			expect(rowsOf(db, 'volunteer_role_capability', 'volunteer_role_id', id), id).toEqual(
				[...grants].sort()
			);
		}
	});

	it('changes nothing when the copy runs a second time', () => {
		const before = [count(db, 'group_capability'), count(db, 'volunteer_role_capability')];
		for (const statement of COPY.split('--> statement-breakpoint')) db.exec(statement);
		expect([count(db, 'group_capability'), count(db, 'volunteer_role_capability')]).toEqual(before);
		db.close();
	});

	it('keeps every grant through every later migration', () => {
		applyMigrations(file);
		const after = new DatabaseSync(file);
		for (const [id, grants] of Object.entries(GROUPS)) {
			expect(rowsOf(after, 'group_capability', 'group_id', id), id).toEqual([...grants].sort());
		}
		// A superset: later backfills may add a role grant (the door role gains finance.collect).
		for (const [id, grants] of Object.entries(ROLES)) {
			expect(rowsOf(after, 'volunteer_role_capability', 'volunteer_role_id', id), id).toEqual(
				expect.arrayContaining([...grants])
			);
		}
		after.close();
	});

	it('leaves the tables as the only copy once the JSON columns are dropped', () => {
		const after = new DatabaseSync(file);
		const columns = (table: string) =>
			(after.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).map(
				(c) => c.name
			);
		expect(columns('group')).not.toContain('capability_grants');
		expect(columns('volunteer_role')).not.toContain('capability_grants');
		after.close();
	});
});
