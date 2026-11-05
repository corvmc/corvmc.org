import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { variables } from './env';

const SRC = import.meta.dirname;
const IMPORT =
	/import\s*\{\s*env(?:\s+as\s+(\w+))?\s*\}\s*from\s*'\$env\/dynamic\/(private|public)'/g;

function* sources(dir: string): Generator<string> {
	for (const name of readdirSync(dir)) {
		if (name === 'paraglide') continue;
		const path = join(dir, name);
		if (statSync(path).isDirectory()) yield* sources(path);
		else if (/\.(ts|js|svelte)$/.test(name) && !/\.spec\.ts$/.test(name)) yield path;
	}
}

/** `NAME` for each `<local>.NAME` or `<local>?.NAME` a module reads from an `$env` import. */
function reads(): { file: string; name: string; kind: string }[] {
	const out: { file: string; name: string; kind: string }[] = [];
	for (const file of sources(SRC)) {
		const text = readFileSync(file, 'utf8');
		for (const [, alias, kind] of text.matchAll(IMPORT)) {
			const member = new RegExp(`(?<![\\w.$])${alias ?? 'env'}\\??\\.([A-Z][A-Z0-9_]*)\\b`, 'g');
			for (const [, name] of text.matchAll(member)) {
				out.push({ file: relative(SRC, file), name, kind });
			}
		}
	}
	return out;
}

// Kit 3 exposes only the variables src/env.ts declares, so a read of anything
// else is `undefined` in production with no error anywhere.
describe('src/env.ts', () => {
	it('declares every variable read through $env/dynamic', () => {
		const undeclared = reads().filter(({ name, kind }) => {
			if (!(name in variables)) return true;
			const isPublic = (variables as Record<string, { public?: boolean }>)[name].public === true;
			// A PUBLIC_ name read from the private module is undefined by design, as in kit 2.
			return kind === 'public' && !isPublic;
		});
		expect(undeclared).toEqual([]);
	});
});
