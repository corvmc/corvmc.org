import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROLES, keyRole } from '../../eslint-rules/message-key-role.js';

/**
 * The mechanical half of docs/development/writing.md, run over the catalog by
 * the role each key's suffix names (#2513). Judgement checks stay in review.
 */

const ROOT = join(import.meta.dirname, '..', '..');

export type Check = 'T4' | 'T5' | 'T6' | 'L1' | 'L3' | 'SC';

export interface Catalog {
	file: string;
	messages: Record<string, unknown>;
}

export function catalogs(): Catalog[] {
	const settings = JSON.parse(readFileSync(join(ROOT, 'project.inlang/settings.json'), 'utf8'));
	return settings['plugin.inlang.messageFormat'].pathPattern.map((p: string) => {
		const file = p.replace('{locale}', 'en').replace(/^\.\//, '');
		const { $schema: _, ...messages } = JSON.parse(readFileSync(join(ROOT, file), 'utf8'));
		return { file, messages };
	});
}

/** Every wording a message can render: the string, or each branch of a plural. */
export function variants(value: unknown): string[] {
	if (typeof value === 'string') return [value];
	if (Array.isArray(value)) return value.flatMap(variants);
	if (value && typeof value === 'object' && 'match' in value)
		return Object.values((value as { match: Record<string, unknown> }).match).flatMap(variants);
	return [];
}

/** Words as T6 counts them: markup tags vanish and a placeholder is one word. */
export function wordCount(text: string): number {
	const plain = text.replace(/\{[#/][^}]*\}/g, '').replace(/\{[^}]*\}/g, 'X');
	return plain.trim().split(/\s+/).filter(Boolean).length;
}

const FILLER = /\b(yet|just|now|here|please)\b|!/i;

/** Names that keep their capitals mid-sentence; longest first so a phrase wins over its words. */
export const PROPER_NOUNS = [
	'Corvallis Music Collective',
	'Real Book Club',
	'CMC Radio',
	'Great American Songbook',
	'Google Calendar',
	'Real Book',
	'Corvallis',
	'CorvMC',
	'Collective',
	...['SoundCloud', 'YouTube', 'Spotify', 'Instagram', 'Messenger', 'Zeffy', 'U-tec'],
	...['Apple', 'Outlook', 'Word', 'Excel'],
	'Stripe',
	'Postmark',
	'Markdown',
	'Form 8282',
	'Form 8283',
	...['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
	...['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August'],
	...['September', 'October', 'November', 'December']
];

const NOUN_PATTERN = new RegExp(
	`\\b(?:${[...PROPER_NOUNS].sort((a, b) => b.length - a.length).join('|')})\\b`,
	'g'
);

/**
 * Sentence case: no capitalised word after a sentence starts. Acronyms, proper
 * nouns and placeholders pass; a colon, separator or end mark starts a new one.
 */
export function titleCased(text: string): boolean {
	return sentences(text).some((words) => words.slice(1).some(capitalised));
}

const capitalised = (w: string) => /^\W*[A-Z][a-z]/.test(w);
const CONNECTOR = /^(a|an|the|of|to|in|on|at|for|and|or|&)$/;

/** Each sentence's words, with placeholders, proper nouns and quoted examples gone. */
function sentences(text: string): string[][] {
	const plain = text
		.replace(/\{[^}]*\}/g, ' ')
		.replace(/[“"][^”"]*[”"]/g, ' ')
		.replace(NOUN_PATTERN, ' ');
	return plain
		.split(/[:.?!|·—–→]\s/)
		.map((s) => s.split(/[\s\-/]+/).filter((w) => /[A-Za-z]/.test(w)));
}

/**
 * Title Case inside prose: two capitalised words in a row after a sentence's
 * first word, with "a", "of", "the" and the like allowed between them. Running
 * text may capitalise one word to name a button or tab ("Use Edit"); a Title
 * Case run ("Use Message a Member") is a label written in the wrong case.
 */
export function titleCaseRun(text: string): boolean {
	return sentences(text).some((words) => {
		let run = 0;
		for (const w of words.slice(1)) {
			if (capitalised(w)) run++;
			else if (!CONNECTOR.test(w)) run = 0;
			if (run >= 2) return true;
		}
		return false;
	});
}

/** A string with no sentence in it — a heading, badge or tile caption whatever its key says. */
const fragment = (text: string) => !/[.?!…]$/.test(text) && wordCount(text) <= 6;

/** The checks one wording fails for the role its key ends in. */
export function failures(role: (typeof ROLES)[number] | null, text: string): Check[] {
	const out: Check[] = [];
	const trimmed = text.trim();
	if (role === 'title') {
		if (FILLER.test(trimmed)) out.push('T4');
		if (/\.$/.test(trimmed) && !/\.\.\.$|…$/.test(trimmed)) out.push('T5');
		if (wordCount(trimmed) > 6) out.push('T6');
	}
	if (role === 'label' && /\?$/.test(trimmed)) out.push('L1');
	if (role === 'checkbox' && wordCount(trimmed) > 8) out.push('L3');
	if (role === 'title' || role === 'label' || role === 'checkbox') {
		if (titleCased(trimmed)) out.push('SC');
	} else if (role !== 'placeholder') {
		// A placeholder is an example value, and an example is often a name.
		if (fragment(trimmed) ? titleCased(trimmed) : titleCaseRun(trimmed)) out.push('SC');
	}
	return out;
}

/** key → the checks any of its wordings fails, for every key that fails one. */
export function violations(list: Catalog[] = catalogs()): Record<string, Check[]> {
	const out: Record<string, Check[]> = {};
	for (const { messages } of list)
		for (const [key, value] of Object.entries(messages)) {
			// Illustrations draw a ticket, a setlist and a keyfob, printed as the real ones are.
			if (key.startsWith('term_') || key.startsWith('illustrations_')) continue;
			const found = new Set(variants(value).flatMap((text) => failures(keyRole(key), text)));
			if (found.size) out[key] = [...found].sort();
		}
	return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
}
