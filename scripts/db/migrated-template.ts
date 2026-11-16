import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { applyMigrations, MIGRATIONS_FOLDER } from './migrate-local';

/**
 * Migrates one scratch file now, and returns a function that opens a private copy
 * of it. Call it at module scope, in `describe` or in `beforeAll`: the replay takes
 * seconds and grows with every migration, so inside a test it meets the 5s timeout
 * on a loaded machine (#3000). `migration-replay-scope.spec.ts` enforces where.
 */
export function migratedTemplate(migrationsFolder = MIGRATIONS_FOLDER): () => DatabaseSync {
	const dir = mkdtempSync(join(tmpdir(), 'corvmc-migrated-'));
	const template = join(dir, 'template.sqlite');
	applyMigrations(template, migrationsFolder);
	let copies = 0;
	return () => {
		const file = join(dir, `copy-${copies++}.sqlite`);
		copyFileSync(template, file);
		return new DatabaseSync(file);
	};
}
