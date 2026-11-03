import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { sourceFiles } from './lib/source-files';

/**
 * No spec mocks `drizzle-orm` or one of its subpaths. A mock of it is a second
 * copy of drizzle's export list, so a new operator in a service breaks sibling
 * specs, and a mocked operator agrees with any WHERE. A spec that needs SQL
 * uses `migratedSqlite()`; one that does not mocks `#lib/server/db/index.js` (#2050).
 */
const MOCK = /\bvi\.(?:do)?[mM]ock\(\s*['"`]drizzle-orm(?:\/[^'"`]*)?['"`]/;

const files = sourceFiles(
	['src/**/*.ts', 'scripts/**/*.ts', 'e2e/**/*.ts', 'eslint-rules/**/*.ts'],
	new Set(['scripts/no-drizzle-orm-mock.spec.ts'])
);

describe('no drizzle-orm mocks', () => {
	it('finds files to check', () => {
		expect(files.length).toBeGreaterThan(100);
	});

	it('catches the shapes it is meant to', () => {
		for (const line of [
			"vi.mock('drizzle-orm', () => ({ eq: vi.fn() }));",
			'vi.mock("drizzle-orm", async (importOriginal) => ({}));',
			"vi.doMock('drizzle-orm/sqlite-core', () => ({}));"
		]) {
			expect(MOCK.test(line), line).toBe(true);
		}
		expect(MOCK.test("vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));")).toBe(false);
	});

	it('no file mocks drizzle-orm', () => {
		const hits: string[] = [];
		for (const file of files) {
			readFileSync(file, 'utf8')
				.split('\n')
				.forEach((line, i) => {
					if (MOCK.test(line)) hits.push(`${file}:${i + 1}  ${line.trim()}`);
				});
		}
		expect(
			hits,
			`use migratedSqlite() (see .claude/rules/testing.md), or mock $lib/server/db outright:\n${hits.join('\n')}`
		).toEqual([]);
	});
});
