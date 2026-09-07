import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { sourceFiles } from './lib/source-files';
import { filesOverCap } from './lib/comment-blocks';

/**
 * A comment states a constraint the code cannot show; it is not a record of how
 * the code got here. `docs/development/conventions.md#comments` has the rule.
 * This enforces the one part a machine can check: length.
 */
const CAP = 8;

const GLOBS = ['src/**/*.{ts,js,svelte}', 'scripts/**/*.{ts,js}', 'e2e/**/*.{ts,js}'];

/**
 * Files that predate the cap. A path list rather than a line count on purpose:
 * a count is a whole-tree snapshot, so any PR merging alongside yours
 * invalidates it and reddens the merge queue for a change that did nothing
 * wrong. Two PRs editing this list conflict in git instead, which is visible.
 */
const GRANDFATHERED: string[] = JSON.parse(readFileSync('scripts/comment-budget.json', 'utf8'));

describe('comment budget', () => {
	it('allows no over-cap comment block in a file that is not grandfathered', () => {
		const offenders = filesOverCap(sourceFiles(GLOBS, new Set(GRANDFATHERED)), CAP);

		expect(
			offenders,
			`These files have a comment block longer than ${CAP} lines. Shorten it, or move ` +
				`the reasoning into docs/ and leave a one-line pointer:\n` +
				`${offenders.map((file) => `  ${file}`).join('\n')}\n`
		).toEqual([]);
	});

	it('drops a file from the list once it comes under the cap', () => {
		const listed = GRANDFATHERED.filter((file) => existsSync(file));
		const stillOver = new Set(filesOverCap(listed, CAP));
		const cleaned = listed.filter((file) => !stillOver.has(file));

		expect(
			cleaned,
			`These files no longer have an over-cap block. Delete them from ` +
				`scripts/comment-budget.json, so the next change cannot spend what this one ` +
				`freed:\n${cleaned.map((file) => `  ${file}`).join('\n')}\n`
		).toEqual([]);
	});
});
