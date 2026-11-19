import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse } from 'svelte/compiler';

/**
 * The entity components draw their own link. Inside an `<a>` or a `<button>`
 * that is a link in a link, which the HTML parser splits apart, so a
 * server-rendered page fails to hydrate (#3158: `/member` threw
 * HierarchyRequestError). The compiler sees nesting inside one file only.
 */
const LINKING = new Set(['EntityCard', 'EntityIdentity', 'EntityChip']);
const INTERACTIVE = new Set(['a', 'button']);
const SRC = new URL('.', import.meta.url).pathname;
/** A file that never names an entity component cannot nest one, so it is not parsed. */
const NAMES_ONE = new RegExp(`<(${[...LINKING].join('|')})\\b`);

function svelteFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return svelteFiles(path);
		return entry.name.endsWith('.svelte') ? [path] : [];
	});
}

type Node = { type: string; name?: string; attributes?: Node[]; value?: unknown };

/** `link={false}` is the one way to draw an entity component without its link. */
const unlinked = (node: Node) =>
	node.attributes?.some(
		(a) =>
			a.type === 'Attribute' &&
			a.name === 'link' &&
			JSON.stringify(a.value).includes('"value":false')
	);

function offenders(source: string): string[] {
	const found: string[] = [];
	const walk = (node: unknown, inside: string | null) => {
		if (!node || typeof node !== 'object') return;
		if (Array.isArray(node)) return node.forEach((n) => walk(n, inside));
		const n = node as Node;
		if (n.type === 'Component' && inside && LINKING.has(n.name!) && !unlinked(n)) {
			found.push(`<${n.name}> inside <${inside}>`);
		}
		// A snippet renders wherever it is passed, not where it is written.
		if (n.type === 'SnippetBlock') inside = null;
		const next = n.type === 'RegularElement' && INTERACTIVE.has(n.name!) ? n.name! : inside;
		for (const [key, value] of Object.entries(n)) {
			if (key !== 'parent' && key !== 'metadata') walk(value, next);
		}
	};
	walk(parse(source, { modern: true }).fragment, null);
	return found;
}

describe('entity links', () => {
	// A whole-tree scan overran vitest's 5s default on a loaded CI runner (#3285).
	// The bound matches the other whole-tree specs: generous costs nothing when fast.
	it('are never drawn inside another link or a button', { timeout: 600_000 }, () => {
		const sources = svelteFiles(SRC)
			.map((file) => ({ file, source: readFileSync(file, 'utf8') }))
			.filter(({ source }) => NAMES_ONE.test(source));
		// Canary: a filter that stops matching would pass vacuously.
		expect(sources.length).toBeGreaterThan(0);
		const found = sources.flatMap(({ file, source }) =>
			offenders(source).map((o) => `${relative(SRC, file)}: ${o}`)
		);
		expect(found).toEqual([]);
	});

	it('catches the shape it is for', () => {
		const source = `<a href="/x"><EntityCard {ref} /></a><a href="/y"><EntityIdentity {ref} link={false} /></a>`;
		expect(offenders(source)).toEqual(['<EntityCard> inside <a>']);
	});
});
