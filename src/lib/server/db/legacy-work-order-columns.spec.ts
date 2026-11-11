import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * The `work_order` columns that moved to `volunteer_shift` or were retired
 * (#2518) keep their database names until a later migration drops them, under
 * `legacy*` property names. Only the schema and the helpers that strip them
 * may name those properties, so no reader of the old times, places or posting
 * flag can come back. Raw SQL is the other route, so it is scanned too.
 */

const ROOTS = ['src', 'scripts', 'e2e'];
const ALLOWED = new Set([
	'src/lib/server/db/schema/volunteer.ts',
	'src/lib/server/volunteer/work-order-service.ts'
]);
const LEGACY =
	/\blegacy(StartsAt|EndsAt|Capacity|PostedAt|PostedByUserId|CloseReportsOnCompletion)\b/;
/** A raw reference to a retired column through a `work_order` alias. */
const RAW = /\bwo\."(posted_at|posted_by_user_id|close_reports_on_completion)"/;

function sourceFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(full);
		// Specs may name them to assert they are not written.
		if (/\.spec\.ts$/.test(entry.name)) return [];
		return /\.(ts|svelte)$/.test(entry.name) ? [full] : [];
	});
}

describe('retired work_order columns', () => {
	it('are named only by the schema and the helpers that strip them', () => {
		const offenders = ROOTS.flatMap((root) => sourceFiles(join(process.cwd(), root)))
			.map((file) => relative(process.cwd(), file))
			.filter((file) => !ALLOWED.has(file))
			.filter((file) => {
				const text = readFileSync(file, 'utf8');
				return LEGACY.test(text) || RAW.test(text);
			});
		expect(offenders).toEqual([]);
	});
});
