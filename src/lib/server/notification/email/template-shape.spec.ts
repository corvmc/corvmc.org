import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURES } from './fixtures';

// Mustachio scopes `{{#name}}…{{/name}}` to its value and never walks back up,
// so inside a section entered on a string or a boolean the only names that
// resolve are `{{.}}` and `../`-prefixed ones — everything else renders empty
// (#1125). Which sections those are is read off the fixture models rather than
// guessed: a section holding an object or an array does scope into it.

const ROOT = 'postmark/templates';

/** `{{#name}}` … `{{/name}}`, innermost first so a nested section is its own match. */
const SECTION = /\{\{#(\w+)\}\}((?:(?!\{\{[#/]\w+\}\})[\s\S])*?)\{\{\/\1\}\}/g;

/** `{{x}}`, `{{{x}}}` and `{{#each x}}` — but not `{{.}}`, `{{{.}}}` or `{{../x}}`. */
const LOOKUP = /\{\{(?:#each\s+|\{)?(\w+)\}?\}\}/g;

/** Every scalar-valued key across the fixtures for one alias. */
function scalarKeys(alias: string): Set<string> {
	const keys = new Set<string>();
	for (const fixture of FIXTURES.filter((f) => f.alias === alias)) {
		for (const [key, value] of Object.entries(fixture.model)) {
			if (value !== null && typeof value !== 'object') keys.add(key);
		}
	}
	return keys;
}

const ALIASES = [...new Set(FIXTURES.map((f) => f.alias))];

describe.each(ALIASES)('%s', (alias) => {
	const scalars = scalarKeys(alias);

	// A template dir with no content.html is text-only.
	const files = ['content.html', 'content.txt'].filter((f) => existsSync(join(ROOT, alias, f)));

	it.each(files)('resolves every lookup in %s', (file) => {
		const source = readFileSync(join(ROOT, alias, file), 'utf8');

		const unreachable: string[] = [];
		for (const section of source.matchAll(SECTION)) {
			const [, name, body] = section;
			if (!scalars.has(name)) continue;
			for (const lookup of body.matchAll(LOOKUP)) {
				unreachable.push(`{{#${name}}} … {{${lookup[1]}}}`);
			}
		}

		expect(unreachable).toEqual([]);
	});
});
