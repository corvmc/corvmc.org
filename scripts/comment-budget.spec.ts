import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { sourceFiles } from './lib/source-files';
import { overCapLinesByDirectory } from './lib/comment-blocks';

/**
 * A comment states a constraint the code cannot show; it is not a record of how
 * the code got here. `docs/development/conventions.md#style` has the rule. This
 * enforces the one part of it a machine can check: length.
 */
const CAP = 8;

const GLOBS = ['src/**/*.{ts,js,svelte}', 'scripts/**/*.{ts,js}', 'e2e/**/*.{ts,js}'];

const budget: Record<string, number> = JSON.parse(
	readFileSync('scripts/comment-budget.json', 'utf8')
);

describe('comment budget', () => {
	it('holds every directory to its recorded ceiling', () => {
		const actual = overCapLinesByDirectory(sourceFiles(GLOBS, new Set()), CAP);

		const grew = Object.entries(actual)
			.filter(([dir, lines]) => lines > (budget[dir] ?? 0))
			.map(([dir, lines]) => `  ${dir}: ${budget[dir] ?? 0} -> ${lines}`);

		expect(
			grew,
			`Comment blocks longer than ${CAP} lines grew in these directories.\n` +
				`Shorten the comment, or move the reasoning into docs/ and leave a pointer:\n` +
				`${grew.join('\n')}\n`
		).toEqual([]);

		const shrank = Object.entries(budget)
			.filter(([dir, lines]) => (actual[dir] ?? 0) < lines)
			.map(([dir, lines]) => `  ${dir}: ${lines} -> ${actual[dir] ?? 0}`);

		expect(
			shrank,
			`Comment blocks shrank — lower the ceilings in scripts/comment-budget.json ` +
				`so the next change cannot spend what this one freed:\n${shrank.join('\n')}\n`
		).toEqual([]);
	});
});
