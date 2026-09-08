import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { DELEGATED, nearestIndex, checkDocIndexes } from './check-docs-drift.mjs';

// A folder README is a landing page on github.com, not a second catalog: `docs/README.md`
// stays the one index and the folder README carries `<!-- docs-index: delegated -->`. The
// risk in that marker is that it becomes a way to opt a folder out of the index check
// entirely, which is the failure the check exists to catch — so what is pinned here is that
// delegation moves ownership up rather than removing it.

const bodies: Record<string, string> = {
	'docs/README.md': 'names architecture-doc.md and nested-doc.md',
	'docs/sub/README.md': 'orientation only\n<!-- docs-index: delegated -->',
	'docs/owned/README.md': 'a real index that names owned-doc.md'
};
const readmes = new Set(Object.keys(bodies));
const bodyOf = (p: string) => bodies[p] ?? '';

describe('nearestIndex', () => {
	it('passes ownership up past a delegating README', () => {
		expect(nearestIndex(readmes, bodyOf, 'docs/sub/nested-doc.md')).toBe('docs/README.md');
	});

	it('keeps ownership at a README that does not delegate', () => {
		expect(nearestIndex(readmes, bodyOf, 'docs/owned/owned-doc.md')).toBe('docs/owned/README.md');
	});

	it('never lets a README own itself', () => {
		expect(nearestIndex(readmes, bodyOf, 'docs/owned/README.md')).toBe('docs/README.md');
	});

	it('returns null when nothing above the file is an index', () => {
		expect(nearestIndex(new Set(), bodyOf, 'docs/sub/nested-doc.md')).toBeNull();
	});
});

describe('DELEGATED', () => {
	it('matches the marker with the spacing prettier produces', () => {
		expect(DELEGATED.test('<!-- docs-index: delegated -->')).toBe(true);
		expect(DELEGATED.test('<!--docs-index:delegated-->')).toBe(true);
	});

	it('does not match prose that merely mentions delegating', () => {
		expect(DELEGATED.test('This folder delegates its docs-index to the parent.')).toBe(false);
	});
});

describe('the real docs tree', () => {
	it('has every doc named by the index that owns it', () => {
		expect(checkDocIndexes()).toEqual([]);
	});

	it('names every file under a delegating folder in docs/README.md', () => {
		const root = readFileSync('docs/README.md', 'utf-8');
		const missing: string[] = [];
		for (const dir of readdirSync('docs', { withFileTypes: true }).filter((d) => d.isDirectory())) {
			const readme = `docs/${dir.name}/README.md`;
			let text: string;
			try {
				text = readFileSync(readme, 'utf-8');
			} catch {
				continue;
			}
			if (!DELEGATED.test(text)) continue;
			for (const f of readdirSync(`docs/${dir.name}`)) {
				if (f.endsWith('.md') && f !== 'README.md' && !root.includes(f)) missing.push(f);
			}
		}
		expect(missing).toEqual([]);
	});
});
