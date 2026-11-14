import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { titleCased } from './lib/message-copy.js';
import { sourceFiles } from './lib/source-files';

/**
 * Help article titles live in markdown frontmatter, outside the message catalog,
 * so `message-copy.spec.ts` cannot hold them to sentence case. This runs the
 * same check over every `title:` that `scripts/sync-help-articles.ts` publishes.
 */
const files = sourceFiles(['src/content/help/**/*.md'], new Set());

describe('help article titles', () => {
	it('finds help articles to check', () => {
		expect(files.length).toBeGreaterThan(50);
	});

	it('are sentence case (docs/development/writing.md)', () => {
		const hits = files.flatMap((file) => {
			const title = readFileSync(file, 'utf8').match(/^title:\s*(.+)$/m)?.[1] ?? '';
			return titleCased(title) ? [`${file}  ${title}`] : [];
		});
		expect(hits).toEqual([]);
	});
});
