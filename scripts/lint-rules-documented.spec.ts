import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every rule in `eslint-rules/` has a row in the conventions table.
 *
 * The gap has opened twice — #1210 found the section claiming seven rules over
 * eight rows with ten on disk, and #1211 was filed for two more. A rule nobody
 * can find is a rule that reads as an unexplained CI failure.
 */

const ROOT = join(import.meta.dirname, '..');
const DOC = 'docs/development/conventions.md';

function rulesOnDisk(): string[] {
	return readdirSync(join(ROOT, 'eslint-rules'))
		.filter((f) => f.endsWith('.js'))
		.map((f) => f.replace(/\.js$/, ''))
		.sort();
}

function documented(): Set<string> {
	const md = readFileSync(join(ROOT, DOC), 'utf8');
	return new Set([...md.matchAll(/`custom\/([a-z0-9-]+)`/g)].map((m) => m[1]));
}

describe('custom lint rules', () => {
	it('documents every rule in the conventions table', () => {
		const doc = documented();
		const undocumented = rulesOnDisk().filter((r) => !doc.has(r));

		expect(undocumented, `add a row to ${DOC} → Custom ESLint rules`).toEqual([]);
	});

	it('keeps the table honest about what exists', () => {
		// A row for a rule that was deleted sends the next reader looking for a
		// file that is not there.
		const onDisk = new Set(rulesOnDisk());
		const orphans = [...documented()].filter((r) => !onDisk.has(r)).sort();

		expect(orphans, `no such rule in eslint-rules/ — remove the row from ${DOC}`).toEqual([]);
	});
});
