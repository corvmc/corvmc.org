import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_FOLDER } from './migrate-local';

function statementsOf(folder: string): string[] {
	const text = readFileSync(join(MIGRATIONS_FOLDER, folder, 'migration.sql'), 'utf8');
	return text.split('--> statement-breakpoint').filter((s) => s.trim());
}

/**
 * The statements of the migration that writes the three grant templates (#2622),
 * then the one that gives the application its order (#2625). A wipe empties them
 * (the dev seed's, the e2e reset), so both replay these: one copy of the template
 * text. Every statement is a no-op the second time.
 */
export function grantStageTemplateStatements(): string[] {
	const folders = readdirSync(MIGRATIONS_FOLDER).sort();
	const templates = folders.find((f) => f.endsWith('_grant_stage_templates'));
	if (!templates) throw new Error('The grant_stage_templates migration is missing.');
	// Found by what it writes: its folder name is drizzle's random one.
	const order = folders
		.filter((f) => /^\d{14}_/.test(f))
		.flatMap(statementsOf)
		.filter((s) => s.includes('INSERT OR IGNORE INTO duty_list_item_dependency'));
	if (order.length === 0) throw new Error('The grant template order migration is missing.');
	return [...statementsOf(templates), ...order];
}
