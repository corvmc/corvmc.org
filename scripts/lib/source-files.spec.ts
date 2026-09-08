import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { sourceFiles } from './source-files';

/**
 * `globSync` returns directories as readily as files, and a directory named like
 * a source file is not hypothetical here: vitest's browser mode wrote failure
 * screenshots to `<test dir>/__screenshots__/<file>.svelte.spec.ts/`, whose middle
 * segment matches `src/**\/*.{ts,js,svelte}`. The gates then `readFileSync` every
 * hit, so one flaky browser test surfaced as `EISDIR` in two unrelated schema
 * gates and took a merge-queue slot down with it.
 */
const ROOT = 'scripts/lib/__source_files_fixture__';

beforeAll(() => {
	rmSync(ROOT, { recursive: true, force: true });
	mkdirSync(`${ROOT}/nested`, { recursive: true });
	writeFileSync(`${ROOT}/real.ts`, 'export const a = 1;\n');
	writeFileSync(`${ROOT}/nested/deep.svelte`, '<p>hi</p>\n');
	writeFileSync(`${ROOT}/exempt.ts`, 'export const b = 2;\n');
	// The screenshot layout: a *directory* whose name ends in a source extension.
	mkdirSync(`${ROOT}/__screenshots__/Widget.svelte.spec.ts`, { recursive: true });
	writeFileSync(`${ROOT}/__screenshots__/Widget.svelte.spec.ts/opens.png`, 'not really a png');
});

afterAll(() => {
	rmSync(ROOT, { recursive: true, force: true });
});

describe('sourceFiles', () => {
	it('skips directories that match the glob', () => {
		const files = sourceFiles([`${ROOT}/**/*.{ts,js,svelte}`], new Set());

		expect(files).not.toContain(`${ROOT}/__screenshots__/Widget.svelte.spec.ts`);
		expect(files).toContain(`${ROOT}/real.ts`);
	});

	// The gates' whole contract: every returned path can be read as text.
	it('returns only paths readFileSync can open', () => {
		for (const file of sourceFiles([`${ROOT}/**/*.{ts,js,svelte}`], new Set())) {
			expect(() => readFileSync(file, 'utf8')).not.toThrow();
		}
	});

	it('drops allowed paths and sorts what is left', () => {
		const files = sourceFiles([`${ROOT}/**/*.{ts,js,svelte}`], new Set([`${ROOT}/exempt.ts`]));

		expect(files).toEqual([`${ROOT}/nested/deep.svelte`, `${ROOT}/real.ts`]);
	});
});
