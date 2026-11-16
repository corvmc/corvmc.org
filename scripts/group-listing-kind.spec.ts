import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { sourceFiles } from './lib/source-files';

/**
 * A listing written with `source: 'group'` names its `kind`. Left out, the
 * column default makes a club's or committee's session a show (#2607).
 */
const files = sourceFiles(['src/**/*.ts', 'scripts/**/*.ts', 'e2e/**/*.ts'], new Set()).filter(
	(f) => !f.endsWith('.spec.ts')
);

function missingKind(file: string): string[] {
	const lines = readFileSync(file, 'utf8').split('\n');
	const hits: string[] = [];
	lines.forEach((line, i) => {
		if (!/source:\s*'group'/.test(line)) return;
		const start = lines.findLastIndex((l, j) => j < i && /\.values\(/.test(l));
		if (start < 0 || i - start > 40) return;
		const end = lines.findIndex((l, j) => j > i && /^\s*\}\)/.test(l));
		const block = lines.slice(start, end < 0 ? i + 1 : end + 1).join('\n');
		if (!/\bkind:/.test(block)) hits.push(`${file}:${i + 1}`);
	});
	return hits;
}

describe('group listing inserts', () => {
	it('finds inserts to check', () => {
		expect(files.filter((f) => /source:\s*'group'/.test(readFileSync(f, 'utf8')))).not.toEqual([]);
	});

	it('set kind', () => {
		const hits = files.flatMap(missingKind);
		expect(hits, hits.join('\n')).toEqual([]);
	});
});
