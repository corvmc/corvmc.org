import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sourceFiles } from '../../../scripts/lib/source-files';
import { allStaffNavItems, contentNavItems, staffNavSections, systemNavItems } from './nav-items';

/**
 * A help article names a staff page as **Staff → row → …**, or starts from a
 * section title. The row must be a sidebar label, and after a panel's row
 * (**System**, **Content**) the next step must be one of its pages. Later steps name tabs, header links, records
 * and buttons, which no list here holds.
 */
const rows = new Set(allStaffNavItems().map((r) => r.label));
const sectionTitles = new Set(staffNavSections.map((s) => s.title));
const label = (key: string) => allStaffNavItems().find((r) => r.key === key)?.label;
const panelPages = new Map([
	[label('settings'), new Set(systemNavItems.map((i) => i.label))],
	[label('content'), new Set(contentNavItems.map((i) => i.label))]
]);

const files = sourceFiles(['src/content/help/**/*.md'], new Set());

function staffPaths(text: string): string[][] {
	return [...text.matchAll(/\*\*([^*]+→[^*]+)\*\*/g)]
		.map((match) => match[1].split('→').map((s) => s.replace(/\s+/g, ' ').trim()))
		.flatMap((steps) =>
			steps[0] === 'Staff' || sectionTitles.has(steps[0]) ? [steps.slice(1)] : []
		);
}

function resolves([row, next]: string[]): boolean {
	if (!rows.has(row)) return false;
	const pages = panelPages.get(row);
	if (!pages || !next) return true;
	return pages.has(next.replace(/\.$/, ''));
}

describe('staff paths in help articles', () => {
	it('finds staff paths to check', () => {
		expect(files.flatMap((f) => staffPaths(readFileSync(f, 'utf8'))).length).toBeGreaterThan(10);
	});

	it('name a real sidebar row', () => {
		const misses = files.flatMap((file) =>
			staffPaths(readFileSync(file, 'utf8'))
				.filter((steps) => !resolves(steps))
				.map((steps) => `${file}  ${steps.join(' → ')}`)
		);
		expect(misses).toEqual([]);
	});
});
