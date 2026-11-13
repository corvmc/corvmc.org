/**
 * #2615 gives every event a short code for `/e/<code>`. The backfill fills each
 * NULL code from the app's alphabet, keeps codes already set, and leaves every
 * code unique. Runs it on a migrated scratch file, then runs it again.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations, MIGRATIONS_FOLDER } from './migrate-local';
import { normalizeShortCode, SHORT_CODE_ALPHABET } from '../../src/lib/event-short-code';

const dir = readdirSync(MIGRATIONS_FOLDER).find((n) => n.endsWith('_event_short_code_backfill'));
const BACKFILL = readFileSync(join(MIGRATIONS_FOLDER, dir ?? 'missing', 'migration.sql'), 'utf8');

function runBackfill(db: DatabaseSync) {
	for (const statement of BACKFILL.split('--> statement-breakpoint')) db.exec(statement);
}

const codes = (db: DatabaseSync) =>
	db.prepare('SELECT id, short_code AS code FROM event_listing ORDER BY id').all() as Array<{
		id: string;
		code: string | null;
	}>;

describe('event short-code backfill', () => {
	let db: DatabaseSync;

	beforeAll(() => {
		const file = join(mkdtempSync(join(tmpdir(), 'corvmc-short-code-')), 'd1.sqlite');
		applyMigrations(file);
		db = new DatabaseSync(file);
		db.exec('PRAGMA foreign_keys = OFF');
		const insert = db.prepare(
			`INSERT INTO event_listing (id, title, starts_at, ends_at, source, created_by_user_id, short_code)
			 VALUES (?, 'Show', 1, 2, 'cmc', 'u', ?)`
		);
		for (let i = 0; i < 300; i++) insert.run(`e${String(i).padStart(3, '0')}`, null);
		insert.run('kept', 'abc234');
		runBackfill(db);
	});

	it('spells the same alphabet the app draws from', () => {
		expect(BACKFILL).toContain(`'${SHORT_CODE_ALPHABET}'`);
		expect(BACKFILL).toContain(`% ${SHORT_CODE_ALPHABET.length} + 1`);
	});

	it('gives every event a code the /e/ route accepts', () => {
		for (const { code } of codes(db)) expect(normalizeShortCode(code ?? '')).toBe(code);
	});

	it('keeps a code already set, and leaves every code unique', () => {
		const rows = codes(db);
		expect(rows.find((r) => r.id === 'kept')?.code).toBe('abc234');
		expect(new Set(rows.map((r) => r.code)).size).toBe(rows.length);
	});

	it('changes nothing when run a second time', () => {
		const before = codes(db);
		runBackfill(db);
		expect(codes(db)).toEqual(before);
	});
});
