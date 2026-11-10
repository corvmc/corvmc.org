import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { keyRole } from '../eslint-rules/message-key-role.js';
import { catalogs, failures, violations, wordCount, type Check } from './lib/message-copy.js';

/**
 * The catalog holds every string to the rubric for the role its key names.
 * Strings that already failed when this landed are allowlisted; the area copy
 * issues (#2512, #2514–#2517) fix them, and an entry that stops failing must be
 * deleted, so the list only shrinks. A new failure is fixed, not allowlisted.
 */

const ALLOW = 'scripts/message-copy.allow.json';
const allowed: Record<string, Check[]> = JSON.parse(
	readFileSync(join(import.meta.dirname, '..', ALLOW), 'utf8')
);

describe('message catalog', () => {
	const list = catalogs();
	const keys = list.flatMap(({ messages }) => Object.keys(messages));

	it('ends every key with its role (run `pnpm messages:roles`)', () => {
		const unsuffixed = keys.filter((k) => !k.startsWith('term_') && !keyRole(k));
		expect(unsuffixed).toEqual([]);
	});

	it('defines each key in one file', () => {
		expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
	});

	it('fails no rubric check outside the allowlist, and the allowlist holds no passing entry', () => {
		const found = violations(list);
		const fresh = Object.entries(found)
			.map(([key, checks]) => [key, checks.filter((c) => !allowed[key]?.includes(c))] as const)
			.filter(([, checks]) => checks.length);
		const stale = Object.entries(allowed)
			.map(([key, checks]) => [key, checks.filter((c) => !found[key]?.includes(c))] as const)
			.filter(([, checks]) => checks.length);

		expect(Object.fromEntries(fresh), 'fix the string (docs/development/writing.md)').toEqual({});
		expect(Object.fromEntries(stale), `delete these from ${ALLOW}`).toEqual({});
	});
});

describe('rubric checks', () => {
	it('counts a placeholder as one word and markup as none', () => {
		expect(wordCount('{#strong}Delete{/strong} {bandName} for good')).toBe(4);
	});

	it('holds a title to T4, T5 and T6', () => {
		expect(failures('title', 'No enquiries yet')).toEqual(['T4']);
		expect(failures('title', 'Saved!')).toEqual(['T4']);
		expect(failures('title', 'No one has signed up.')).toEqual(['T5']);
		expect(failures('title', 'Waiting for the card form to load now')).toEqual(['T4', 'T6']);
		expect(failures('title', 'Loading…')).toEqual([]);
		expect(failures('title', 'Upcoming shifts')).toEqual([]);
	});

	it('holds a label to no question and a checkbox to eight words', () => {
		expect(failures('label', "Can't make it?")).toEqual(['L1']);
		expect(
			failures('checkbox', 'Comes off the door before a percentage-of-net deal is worked out')
		).toEqual(['L3']);
		expect(failures('body', 'Be the first to say what the collective should do next.')).toEqual([]);
	});
});
