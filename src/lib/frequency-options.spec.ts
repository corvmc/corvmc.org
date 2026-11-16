import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sourceFiles } from '../../scripts/lib/source-files';

// An option object that pairs a frequency value with its own label.
const LABELLED = /value:\s*['"](weekly|biweekly|monthly)['"]\s*,\s*label:/;

describe('frequency options', () => {
	it('are labelled only by FREQUENCY_LABELS', () => {
		const files = sourceFiles(['src/**/*.{svelte,ts}'], new Set());
		expect(files.length).toBeGreaterThan(100);
		expect(files.filter((f) => LABELLED.test(readFileSync(f, 'utf8')))).toEqual([]);
	});
});
