import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { sourceFiles } from './lib/source-files';

/**
 * Every LIKE goes through `src/lib/server/db/like.ts`. drizzle's `like()` has
 * no ESCAPE clause, so a hand-built `%${term}%` lets `_` and `%` in user input
 * act as wildcards (#1534). The helper escapes the term and declares ESCAPE.
 */
const FORBIDDEN: { pattern: RegExp; what: string }[] = [
	{ pattern: /(?<![\w.])like\(/, what: "drizzle's like()" },
	{ pattern: /\{\s*like:/, what: 'a relational-query { like } filter' },
	{ pattern: /\blike\s+\$\{/i, what: 'a raw sql`… like ${…}`' },
	{ pattern: /`%\$\{/, what: 'a hand-built %${…} pattern' }
];

const ALLOWED = new Set(['src/lib/server/db/like.ts', 'scripts/no-raw-like.spec.ts']);

function isComment(line: string): boolean {
	const t = line.trim();
	return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

// Specs stay out: they assert on rendered patterns and mock drizzle exports.
const files = sourceFiles(['src/**/*.{ts,js,svelte}'], ALLOWED).filter(
	(f) => !f.endsWith('.spec.ts')
);

describe('no raw LIKE', () => {
	it('finds source files to check', () => {
		expect(files.length).toBeGreaterThan(100);
	});

	it.each(FORBIDDEN)('nothing uses $what', ({ pattern }) => {
		const hits: string[] = [];
		for (const file of files) {
			readFileSync(file, 'utf8')
				.split('\n')
				.forEach((line, i) => {
					if (!isComment(line) && pattern.test(line)) hits.push(`${file}:${i + 1}  ${line.trim()}`);
				});
		}
		expect(
			hits,
			`use containsLiteral / startsWithLiteral from $lib/server/db/like:\n${hits.join('\n')}`
		).toEqual([]);
	});
});
