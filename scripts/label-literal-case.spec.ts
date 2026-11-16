import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { titleCased } from './lib/message-copy.js';
import { sourceFiles } from './lib/source-files';

/**
 * A label written as a literal (`label: '…'`, `label="…"`) never reaches the
 * catalog, so `message-copy.spec.ts` cannot hold it to sentence case. This runs
 * the same check over every such literal in source: nav rows, block names, menus.
 */
const LITERAL = /\blabel(?::\s*|=)(['"`])((?:(?!\1)[^\\\n]|\\.)*)\1/g;

const files = sourceFiles(['src/**/*.{ts,svelte}'], new Set()).filter(
	(f) => !/\.(spec|test)\.|\.test\.svelte$/.test(f)
);

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
						if (titleCased(text.replace(/\$\{[^}]*\}/g, '{x}')))
							hits.push(`${file}:${i + 1}  ${text}`);
				});
		}
		expect(hits).toEqual([]);
	});
});
