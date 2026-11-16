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
	'Corvallis',
	'CorvMC',
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
	const plain = text.replace(/\{[^}]*\}/g, ' ').replace(NOUN_PATTERN, ' ');
	return plain.split(/[:.?!|·—–]\s/).some((sentence) => {
		const words = sentence.split(/[\s-]+/).filter((w) => /[A-Za-z]/.test(w));
		return words.slice(1).some((w) => /^\W*[A-Z][a-z]/.test(w));
	});
}

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
	if ((role === 'title' || role === 'label' || role === 'checkbox') && titleCased(trimmed))
		out.push('SC');
	return out;
}

/** key → the checks any of its wordings fails, for every key that fails one. */
export function violations(list: Catalog[] = catalogs()): Record<string, Check[]> {
	const out: Record<string, Check[]> = {};
	for (const { messages } of list)
		for (const [key, value] of Object.entries(messages)) {
			if (key.startsWith('term_')) continue;
			const found = new Set(variants(value).flatMap((text) => failures(keyRole(key), text)));
			if (found.size) out[key] = [...found].sort();
		}
	return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
}
