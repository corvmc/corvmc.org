import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { sourceFiles } from './lib/source-files';

/**
 * Every write to `inbox_thread.preview` goes through `messagePreview()`, which
 * strips markdown on markdown channels. A preview computed in SQL from a raw
 * body shows the syntax in thread lists and emails (#2673).
 */

/** The text of each `preview:` property, up to its closing comma at depth 0. */
function previewValues(source: string): { line: number; value: string }[] {
	const out: { line: number; value: string }[] = [];
	for (const match of source.matchAll(/(?<![\w.])preview:\s*/g)) {
		const start = match.index + match[0].length;
		let depth = 0;
		let end = start;
		for (; end < source.length; end++) {
			const c = source[end];
			if ('([{'.includes(c) || (c === '`' && depth === 0)) depth++;
			else if (')]}'.includes(c) || c === '`') depth--;
			if (depth < 0 || (depth === 0 && (c === ',' || c === ';' || c === '\n'))) break;
		}
		const line = source.slice(0, match.index).split('\n').length;
		out.push({ line, value: source.slice(start, end).trim() });
	}
	return out;
}

const ALLOWED_VALUE = [
	/^inboxThread\.preview$/, // a read
	/^string( \| null)?$/, // a type
	/messagePreview\(/
];

// Only files that write the table; elsewhere `preview` means something else.
const writers = sourceFiles(['src/**/*.ts'], new Set()).filter(
	(f) => !f.endsWith('.spec.ts') && /\.(update|insert)\(inboxThread\)/.test(readFileSync(f, 'utf8'))
);

describe('thread preview writes', () => {
	it('finds the files that write inbox_thread', () => {
		expect(writers.length).toBeGreaterThan(3);
	});

	it('reads the whole value of a multi-line property', () => {
		const src = 'set({\n\tpreview: sql`a, ${b(c, d)}\n\t\te`,\n\tx: 1\n})';
		expect(previewValues(src)).toEqual([{ line: 2, value: 'sql`a, ${b(c, d)}\n\t\te`' }]);
	});

	it('sets inbox_thread.preview only through messagePreview()', () => {
		const hits: string[] = [];
		for (const file of writers) {
			for (const { line, value } of previewValues(readFileSync(file, 'utf8'))) {
				if (!ALLOWED_VALUE.some((ok) => ok.test(value))) hits.push(`${file}:${line}  ${value}`);
			}
		}
		expect(hits, `wrap the body in messagePreview(body, channel):\n${hits.join('\n')}`).toEqual([]);
	});
});
