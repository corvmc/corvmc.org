import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The `contact` table has exactly one access path, and this is what proves it.
 *
 * `contact-service.ts` guards every export with `requireStaff()` itself, but
 * that only helps if nothing else can reach the table. The ESLint rule
 * `custom/no-contact-schema-imports` is what makes that true, and a rule is the
 * only mechanism that can police a file nobody has written yet.
 *
 * A grep gate rather than a type check, for the same reason
 * `scripts/no-band-roster-names.spec.ts` is one: this is a fact about which
 * *files* mention a symbol, and no type in the program expresses it. It also
 * catches the case the lint rule's own tests cannot — that the rule is still
 * registered and still enabled.
 */

const ROOT = join(import.meta.dirname, '..', '..', '..', '..');

/** The files allowed to name the table. Kept in step with the rule's own list. */
const ALLOWED = new Set([
	'src/lib/server/directory/contact-service.ts',
	'src/lib/server/db/schema/contact.ts',
	// The barrel: drizzle-kit reads it to see the table at all, so a migration
	// cannot be generated without this line. That is exactly why the lint rule
	// matches the imported *symbol* rather than only the module path — banning
	// the path alone would leave `from '$lib/server/db/schema'` wide open.
	'src/lib/server/db/schema/index.ts',
	'src/lib/server/directory/contact-service.spec.ts',
	'src/lib/server/directory/contact-boundary.spec.ts'
]);

function walk(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		if (name === 'node_modules' || name.startsWith('.')) continue;
		const full = join(dir, name);
		if (statSync(full).isDirectory()) walk(full, out);
		else if (/\.(ts|svelte)$/.test(name)) out.push(full);
	}
	return out;
}

const files = walk(join(ROOT, 'src')).map((f) => f.slice(ROOT.length + 1).replaceAll('\\', '/'));

describe('the contact table has one access path', () => {
	it('finds source files to check', () => {
		expect(files.length).toBeGreaterThan(100);
	});

	it('is imported nowhere but its service, its schema and the barrel', () => {
		const importers = files.filter((f) => {
			if (ALLOWED.has(f)) return false;
			const src = readFileSync(join(ROOT, f), 'utf8');
			// The shape the lint rule bans: the symbol, from any schema module.
			return /import\s*\{[^}]*\bcontact\b[^}]*\}\s*from\s*['"][^'"]*schema/.test(src);
		});
		expect(importers).toEqual([]);
	});

	/**
	 * The rule being registered is half of the protection; the other half is that
	 * it is switched on. A rule present in the plugin map but enabled for no
	 * files would pass every other assertion here.
	 */
	it('keeps the lint rule registered and enabled', () => {
		const config = readFileSync(join(ROOT, 'eslint.config.js'), 'utf8');
		expect(config).toContain("'no-contact-schema-imports': noContactSchemaImports");
		expect(config).toContain("'custom/no-contact-schema-imports': 'error'");
	});

	/**
	 * Every export that reads or writes the table guards itself. Asserted against
	 * the source because the point is that a *future* export cannot skip it — a
	 * runtime test only covers the exports that exist today.
	 */
	it('guards every staff-facing export at its own boundary', () => {
		const src = readFileSync(join(ROOT, 'src/lib/server/directory/contact-service.ts'), 'utf8');
		const exports = [...src.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
		expect(exports.length).toBeGreaterThan(0);

		const unguarded = exports.filter((name) => {
			const body = src.slice(src.indexOf(`export async function ${name}`));
			const end = body.indexOf('\n}\n');
			return !body.slice(0, end).includes('requireStaff()');
		});

		// The two deliberate exceptions, each named so that using one looks like
		// what it is: the token path has no session to check, and the archive runs
		// inside an already-guarded claim.
		expect(unguarded.sort()).toEqual(['archiveContactForClaim', 'writeContactUnguarded']);
	});
});
