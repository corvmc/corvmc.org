import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Vite's cold dependency scan follows static imports only. A package reached
// solely by `await import()` is therefore discovered the first time a test
// renders it — mid-run, which re-bundles and reloads the browser, and whatever
// file was importing at that moment fails with "Failed to fetch dynamically
// imported module" and no failed tests at all (#1295).

const CLIENT_ROOT = 'src';

/** `import('x')`, but not `import('./x')` or `import('$lib/x')`. */
const LAZY = /\bimport\(\s*['"]([^.$'"][^'"]*)['"]\s*\)/g;
/** `from 'x'` — the same specifier reached statically anywhere is already scanned. */
const STATIC = /\bfrom\s*['"]([^.$'"][^'"]*)['"]/g;

function clientSources(): string[] {
	return readdirSync(CLIENT_ROOT, { recursive: true, encoding: 'utf8' })
		.filter((f) => /\.(svelte|ts)$/.test(f))
		.filter((f) => !f.includes('.spec.') && !f.startsWith(join('lib', 'server')))
		.map((f) => join(CLIENT_ROOT, f));
}

/** The package a specifier belongs to: `a/b/c` is `a`, `@scope/p/x` is `@scope/p`. */
function packageOf(specifier: string): string {
	const parts = specifier.split('/');
	return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

describe('optimizeDeps.include', () => {
	it('lists every package only an `await import()` reaches', () => {
		const lazy = new Map<string, string>();
		const statik = new Set<string>();

		for (const file of clientSources()) {
			const source = readFileSync(file, 'utf8');
			for (const [, spec] of source.matchAll(LAZY)) lazy.set(spec, file);
			for (const [, spec] of source.matchAll(STATIC)) statik.add(packageOf(spec));
		}

		const config = readFileSync('vite.config.ts', 'utf8');
		const missing = [...lazy]
			.filter(([spec]) => !statik.has(packageOf(spec)))
			.filter(([spec]) => !config.includes(`'${spec}'`))
			.map(([spec, file]) => `${spec} (${file})`);

		expect(missing).toEqual([]);
	});
});
