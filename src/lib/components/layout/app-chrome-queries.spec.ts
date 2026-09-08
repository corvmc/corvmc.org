import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

/**
 * The authenticated chrome fetches nothing of its own (#569).
 *
 * `AppShell` is mounted by the member, staff and band layouts, so a query inside anything it
 * renders runs on every authenticated page. `NotificationBell` and `AccountDropdown` each held
 * one, and `custom/no-concurrent-remote-queries` could not see it: neither fanned out on its
 * own, so the concurrency existed only at the level of the tree. Hence this file.
 */

const LAYOUT_DIR = new URL('.', import.meta.url).pathname;
const SRC = resolve(LAYOUT_DIR, '../../..');
const ROOT = join(SRC, 'lib/components/layout/AppShell.svelte');

/** Value imports as `{ spec, names }`, minus `import type` — a type puts nothing in flight. */
function valueImports(code: string): { spec: string; names: string[] }[] {
	const out: { spec: string; names: string[] }[] = [];
	const re = /(?:^|\n)\s*import\s+([^'"]*?)from\s*['"]([^'"]+)['"]/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(code))) {
		const clause = m[1];
		if (/^\s*type\s/.test(clause)) continue;
		const braces = clause.match(/\{([^}]*)\}/);
		const names = (braces?.[1] ?? '')
			.split(',')
			.map((n) => n.trim())
			// `import { type A, b }` still imports `b` at runtime, so `b` counts.
			.filter((n) => n && !n.startsWith('type '))
			.map((n) => n.split(/\s+as\s+/)[0].trim());
		out.push({ spec: m[2], names });
	}
	return out;
}

/** The names a `.remote.ts` module exports as `query(...)` — its render-time reads. */
function queryExports(file: string): Set<string> {
	const out = new Set<string>();
	const re = /export\s+const\s+(\w+)\s*=\s*query\s*(?:\.\s*batch\s*)?\(/g;
	let m: RegExpExecArray | null;
	const code = readFileSync(file, 'utf8');
	while ((m = re.exec(code))) out.add(m[1]);
	return out;
}

/** Resolve an app-internal specifier to a file, or null when it is a package. */
function resolveSpecifier(fromFile: string, spec: string): string | null {
	let base: string;
	if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec);
	else if (spec.startsWith('$lib/')) base = join(SRC, 'lib', spec.slice('$lib/'.length));
	else return null;

	const candidates = [base, `${base}.svelte`, `${base}.ts`, `${base}.js`, join(base, 'index.ts')];
	return candidates.find((c) => existsSync(c) && !c.endsWith('/')) ?? null;
}

/** Every `.svelte` file reachable from `AppShell` by following app-internal imports. */
function chromeComponents(): string[] {
	const seen = new Set<string>();
	const queue = [ROOT];
	while (queue.length) {
		const file = queue.pop()!;
		if (seen.has(file)) continue;
		seen.add(file);
		for (const { spec } of valueImports(readFileSync(file, 'utf8'))) {
			const target = resolveSpecifier(file, spec);
			if (target?.endsWith('.svelte') && !seen.has(target)) queue.push(target);
		}
	}
	return [...seen];
}

/** The remote *queries* (not commands or forms) a file imports at runtime. */
function queriesImportedBy(file: string): string[] {
	const out: string[] = [];
	for (const { spec, names } of valueImports(readFileSync(file, 'utf8'))) {
		if (!spec.startsWith('$lib/remote/')) continue;
		const module = resolveSpecifier(file, spec);
		if (!module) continue;
		const queries = queryExports(module);
		out.push(...names.filter((n) => queries.has(n)));
	}
	return out.sort();
}

describe('the authenticated app chrome', () => {
	it('mounts a component tree worth checking', () => {
		// Canary: a resolver that silently stops walking would make the assertion
		// below pass over almost nothing.
		expect(chromeComponents().length).toBeGreaterThan(5);
	});

	it('puts no remote query in flight', () => {
		// Commands and forms are fine — they run on a user action, not on render.
		// Only `query()` exports are render-time reads, so only those are counted.
		const offenders = chromeComponents()
			.flatMap((file) => queriesImportedBy(file).map((name) => `${relative(SRC, file)}: ${name}`))
			.sort();

		// A component here renders on every member, staff and band page. Its data
		// belongs in that panel's layout query (`appChrome` in
		// `$lib/remote/layout.remote`), handed down as a prop.
		expect(offenders).toEqual([]);
	});

	it('keeps the two components that carried the fan-out pinned by name', () => {
		// Named explicitly, so they stay covered even if the walk above ever stops
		// reaching them.
		for (const name of ['AppTopbar.svelte', 'NotificationBell.svelte', 'AccountDropdown.svelte']) {
			expect(queriesImportedBy(join(LAYOUT_DIR, name)), name).toEqual([]);
		}
	});

	it('detects a query import when there is one', () => {
		// Canary for the detector: `(public)/+layout.svelte` legitimately awaits
		// `getMe()`, and is the shape this file exists to reject inside the chrome.
		expect(queriesImportedBy(join(SRC, 'routes/(public)/+layout.svelte'))).toEqual(['getMe']);
	});
});
