import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_FOLDER } from './migrate-local';

/**
 * The statements of the migration that writes the three grant templates (#2622).
 * A wipe empties them (the dev seed's, the e2e reset), so both replay these: one
 * copy of the template text. Every statement is a no-op the second time.
 */
export function grantStageTemplateStatements(): string[] {
	const folder = readdirSync(MIGRATIONS_FOLDER).find((f) => f.endsWith('_grant_stage_templates'));
	if (!folder) throw new Error('The grant_stage_templates migration is missing.');
	const text = readFileSync(join(MIGRATIONS_FOLDER, folder, 'migration.sql'), 'utf8');
	return text.split('--> statement-breakpoint').filter((s) => s.trim());
}
