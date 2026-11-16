import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { titleCased } from './lib/message-copy.js';
import { sourceFiles } from './lib/source-files';

/**
 * A label written as a literal (`label: '…'`, `label="…"`) never reaches the
 * catalog, so `message-copy.spec.ts` cannot hold it to sentence case. This runs
 * the same check over every such literal in source: nav rows, block names, menus.
 */
const LITERAL = /\blabel(?:\s*[:=]\s*)(['"`])((?:(?!\1)[^\\\n]|\\.)*)\1/g;

/** A label map: `const channelLabels: Record<Channel, string> = {`, `RESOURCE_LABELS`. */
const MAP = /\b(\w*(?:Labels|LABELS))\b[^=;\n]*=\s*\{/g;
const MAP_VALUE = /:\s*(['"`])((?:(?!\1)[^\\\n]|\\.)*)\1/g;

const files = sourceFiles(['src/**/*.{ts,svelte}'], new Set()).filter(
	(f) => !/\.(spec|test)\.|\.test\.svelte$/.test(f)
);

const fails = (text: string) => titleCased(text.replace(/\$\{[^}]*\}/g, '{x}'));
const lineOf = (source: string, index: number) => source.slice(0, index).split('\n').length;

/** The text of each label map's object literal, from its `{` to the brace that closes it. */
function mapBodies(source: string): { start: number; body: string }[] {
	return [...source.matchAll(MAP)].map((m) => {
		const start = m.index + m[0].length;
		let depth = 1;
		let i = start;
		while (depth && i < source.length) depth += { '{': 1, '}': -1 }[source[i++]] ?? 0;
		return { start, body: source.slice(start, i) };
	});
}

describe('label literals', () => {
	it('finds source files to check', () => {
		expect(files.length).toBeGreaterThan(100);
	});

	it('are sentence case (docs/development/writing.md)', () => {
		const hits: string[] = [];
		for (const file of files) {
			readFileSync(file, 'utf8')
				.split('\n')
				.forEach((line, i) => {
					for (const [, , text] of line.matchAll(LITERAL))
						if (fails(text)) hits.push(`${file}:${i + 1}  ${text}`);
				});
		}
		expect(hits).toEqual([]);
	});
});

describe('label maps', () => {
	const maps = files.flatMap((file) => {
		const source = readFileSync(file, 'utf8');
		return mapBodies(source).map((map) => ({ file, source, ...map }));
	});

	it('finds label maps to check', () => {
		expect(maps.length).toBeGreaterThan(40);
	});

	it('are sentence case (docs/development/writing.md)', () => {
		const hits = maps.flatMap(({ file, source, start, body }) =>
			[...body.matchAll(MAP_VALUE)]
				.filter(([, , text]) => fails(text))
				.map((m) => `${file}:${lineOf(source, start + m.index)}  ${m[2]}`)
		);
		expect(hits).toEqual([]);
	});
});
