import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { keyRole } from '../eslint-rules/message-key-role.js';
import { sourceFiles } from './lib/source-files';
import { retiredTerms } from '../src/lib/config.js';
import {
	catalogs,
	failures,
	variants,
	violations,
	wordCount,
	type Check
} from './lib/message-copy.js';

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

	it('uses no retired term (retiredTerms in src/lib/config.ts)', () => {
		const found = list.flatMap(({ messages }) =>
			Object.entries(messages).flatMap(([key, value]) =>
				retiredTerms
					.filter(({ keys }) => !keys || keys.test(key))
					.flatMap(({ word, use }) =>
						variants(value)
							.filter((text) => word.test(text))
							.map((text) => `${key}: "${text}" (use ${use})`)
					)
			)
		);
		expect(found).toEqual([]);
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

/**
 * A key scope names messages, and help has no keys, so each scoped term says
 * where it applies to help prose: `[]` skips it, `files` limits it to articles,
 * `word` narrows what counts. The spec fails on a scoped term with no entry.
 */
type HelpRule = { files?: RegExp; word?: RegExp };
const helpScope: Record<string, HelpRule[]> = {
	// The return flow (tips, teaching applications) has no article. "Unpublish" is a
	// live label for events, releases and articles; "turned down" is checked unscoped.
	'return / returned': [],
	// "Session" stays for a program's meetings, which only the chairs' article covers.
	reservation: [{ files: /^(?!.*\/staff-program-chairs\.md$)/ }],
	// Staff articles keep "outside act" and the production console's per-act wording.
	band: [{ files: /^(?!.*\/staff-guide\/)/ }],
	// "Listing" stays for directory and resource entries, so outside the event
	// articles only a listing named as an event's counts.
	event: [
		{ files: /\/(events-tickets\/|band-events|staff-events|staff-offsite-events)/ },
		{ word: /\b(event|gig|show) listings?\b/i }
	]
};

/**
 * The prose a help article publishes, one paragraph per entry so a term wrapped
 * across lines still matches: title, summary and body, minus code spans and link
 * targets. `_` is a word character, so `_Book a Session_` would hide its words
 * from `\b`; outside code and URLs it is only emphasis.
 */
function helpProse(source: string): string[] {
	const [, front = '', body = source] = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/) ?? [];
	const shown = front.split('\n').filter((l) => /^(title|summary):/.test(l));
	return [...shown, ...body.split(/\n\s*\n/)].map((block) =>
		block
			.replace(/`[^`]*`/g, '')
			.replace(/\]\([^)]*\)/g, ']')
			.replace(/[_\s]+/g, ' ')
	);
}

function around(text: string, word: RegExp): string | undefined {
	const hit = word.exec(text);
	return hit ? text.slice(Math.max(0, hit.index - 30), hit.index + hit[0].length + 30) : undefined;
}

describe('help articles', () => {
	const files = sourceFiles(['src/content/help/**/*.md'], new Set());

	it('finds help articles to check', () => {
		expect(files.length).toBeGreaterThan(50);
	});

	it('decide where each key-scoped retired term applies', () => {
		const scoped = retiredTerms.filter(({ keys }) => keys).map(({ use }) => use);
		expect(scoped.filter((use) => !(use in helpScope))).toEqual([]);
	});

	it('use no retired term (retiredTerms in src/lib/config.ts)', () => {
		const found = files.flatMap((file) => {
			const blocks = helpProse(readFileSync(file, 'utf8'));
			return retiredTerms.flatMap(({ word, use, keys }) =>
				(keys ? (helpScope[use] ?? []) : [{} as HelpRule])
					.filter((rule) => !rule.files || rule.files.test(file))
					.flatMap((rule) =>
						blocks
							.map((block) => around(block, rule.word ?? word))
							.filter((hit) => hit !== undefined)
							.map((hit) => `${file}: "…${hit.trim()}…" (use ${use})`)
					)
			);
		});
		expect([...new Set(found)]).toEqual([]);
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

	it('holds titles, labels and checkboxes to sentence case', () => {
		expect(failures('title', 'Upcoming Shifts')).toEqual(['SC']);
		expect(failures('label', 'One-Time Donation')).toEqual(['SC']);
		expect(failures('checkbox', 'Email Me Replies')).toEqual(['SC']);
		expect(failures('placeholder', 'e.g. The Velvet Underground')).toEqual([]);
	});

	it('holds a fragment in any other role to sentence case, and prose to no Title Case run', () => {
		expect(failures('text', 'Total This Month')).toEqual(['SC']);
		expect(failures('body', 'Content Flag')).toEqual(['SC']);
		expect(failures('body', 'Use Message a Member above to start one.')).toEqual(['SC']);
		expect(failures('text', 'Use {#strong}Reserve Space{/strong} at the top.')).toEqual(['SC']);
		expect(failures('body', 'Use Edit to reserve the practice space.')).toEqual([]);
		expect(failures('body', 'Shown as “Based In” on your profile.')).toEqual([]);
		expect(failures('text', 'Events at the Collective')).toEqual([]);
	});

	it('lets proper nouns, acronyms, placeholders and new sentences keep capitals', () => {
		expect(failures('title', 'Play on CMC Radio')).toEqual([]);
		expect(failures('title', 'Events | Corvallis Music Collective')).toEqual([]);
		expect(failures('label', 'Download PDF')).toEqual([]);
		expect(failures('label', 'Message {Name}')).toEqual([]);
		expect(failures('title', 'Step 2: Pick a room')).toEqual([]);
		expect(failures('title', 'Record Form 8282')).toEqual([]);
	});
});
