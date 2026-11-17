import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { sourceFiles } from './lib/source-files';

/**
 * A rejected alternative is a "Not X, because Y (#n)" line in the living doc that states the rule
 * (#3161). `docs/decisions/` is gone, so a path into it or a record number is a dead reference.
 * Committed migrations are immutable and are not globbed.
 */
const FORBIDDEN = [/docs\/decisions\b/, /\.\.\/decisions\//, /\b[Dd]ecisions? (record )?\d{4}\b/];

const GLOBS = [
	'*.md',
	'docs/**/*.md',
	'.claude/**/*.md',
	'src/**/*.{ts,js,svelte,md}',
	'scripts/**/*.{ts,js,mjs,sql}',
	'e2e/**/*.{ts,js}',
	'eslint.config.js'
];

const files = sourceFiles(GLOBS, new Set(['scripts/no-decision-records.spec.ts']));

describe('no decision records', () => {
	it('has no docs/decisions folder', () => {
		expect(existsSync('docs/decisions')).toBe(false);
	});

	it('finds files to check', () => {
		expect(files.length).toBeGreaterThan(100);
	});

	it('nothing cites a decision record', () => {
		const hits: string[] = [];
		for (const file of files) {
			readFileSync(file, 'utf8')
				.split('\n')
				.forEach((line, i) => {
					if (FORBIDDEN.some((p) => p.test(line))) hits.push(`${file}:${i + 1}  ${line.trim()}`);
				});
		}
		expect(hits, `cite the living doc section or the issue instead:\n${hits.join('\n')}`).toEqual(
			[]
		);
	});
});
