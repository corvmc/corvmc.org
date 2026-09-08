import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { NOTIFICATION_TYPES } from '$lib/server/db/schema/notification';

/**
 * Email headings and button labels are sentence case (#646).
 *
 * The tree drifted once already: subjects and bell titles stayed sentence case
 * while headings and CTAs went Title Case, so one notification read two ways at
 * once — "Reservation cancelled" in the bell, "Reservation Cancelled" in the
 * mail. A sweep fixes the day it runs; only a guard keeps it fixed.
 */

const SOURCES = [
	{
		path: 'src/lib/server/notification/notification-listeners.ts',
		keys: ['subject', 'title', 'heading', 'label']
	},
	// Fixture subjects stand in for text a member typed into a form, so only the
	// fields this repo writes itself are checked in there.
	{
		path: 'src/lib/server/notification/email/fixtures.ts',
		keys: ['heading', 'label']
	}
];

/** Words that keep their capital mid-sentence. */
const PROPER_NOUNS = new Set([
	'Collective',
	'Corvallis',
	'CorvMC',
	'CMC',
	'Monday',
	'Tuesday',
	'Wednesday',
	'Thursday',
	'Friday',
	'Saturday',
	'Sunday',
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December'
]);

/**
 * Capitalised mid-sentence words in `value`, ignoring anything interpolated —
 * a band name or an event title arrives already capitalised and is not ours.
 */
function titleCasedWords(value: string): string[] {
	const found: string[] = [];
	let sentenceStart = true;
	for (const token of value.split(/\s+/).filter(Boolean)) {
		const word = token.replace(/^[^\p{L}]+/u, '').replace(/[^\p{L}]+$/u, '');
		if (!sentenceStart && /^[A-Z][a-z]+$/.test(word) && !PROPER_NOUNS.has(word)) found.push(word);
		sentenceStart = /[.?!:]$/.test(token);
	}
	return found;
}

/**
 * Every string literal under `node`. A template literal is rebuilt with `${}`
 * standing in for each interpolation, and is not descended into: the
 * expressions inside it are values, not copy.
 */
function literals(node: ts.Node): string[] {
	const out: string[] = [];
	const visit = (n: ts.Node) => {
		if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
			out.push(n.text);
			return;
		}
		if (ts.isTemplateExpression(n)) {
			out.push(n.head.text + n.templateSpans.map((s) => `\${}${s.literal.text}`).join(''));
			return;
		}
		ts.forEachChild(n, visit);
	};
	visit(node);
	return out;
}

/** Copy assigned to one of `keys` anywhere in the file, ternaries included. */
function copyStrings(path: string, keys: string[]): { key: string; value: string }[] {
	const source = ts.createSourceFile(
		path,
		readFileSync(path, 'utf8'),
		ts.ScriptTarget.Latest,
		true
	);
	const found: { key: string; value: string }[] = [];
	const visit = (n: ts.Node) => {
		if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && keys.includes(n.name.text)) {
			for (const value of literals(n.initializer)) found.push({ key: n.name.text, value });
		}
		ts.forEachChild(n, visit);
	};
	visit(source);
	return found;
}

/**
 * Headings and button labels baked into a static Postmark template.
 *
 * `notification` takes both from its model, but `ticket-confirmation` and
 * `password-reset` write theirs into the HTML — where the text part of the same
 * mail already said "You're going" while the HTML said "You're Going".
 * `_layouts/` is skipped: its only anchors are the address and footer links.
 */
function templateCopy(): { path: string; value: string }[] {
	const root = 'postmark/templates';
	const found: { path: string; value: string }[] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if (!entry.isDirectory() || entry.name === '_layouts') continue;
		const path = join(root, entry.name, 'content.html');
		if (!existsSync(path)) continue;
		const source = readFileSync(path, 'utf8');
		for (const match of source.matchAll(/<(h1|a)\b[^>]*>([^<]*)<\/\1>/g)) {
			const value = match[2].trim();
			if (value && !value.includes('{{')) found.push({ path, value });
		}
	}
	return found;
}

describe('notification copy casing', () => {
	it.each(SOURCES)('$path writes sentence case', ({ path, keys }) => {
		const strings = copyStrings(path, keys);
		expect(strings.length).toBeGreaterThan(0);

		const offenders = strings
			.map(({ key, value }) => ({ key, value, words: titleCasedWords(value) }))
			.filter((entry) => entry.words.length > 0)
			.map((entry) => `${entry.key}: ${JSON.stringify(entry.value)} — ${entry.words.join(', ')}`);

		expect(
			offenders,
			`Title Case in notification copy. Sentence case is the rule ` +
				`(design-system/project/README.md, "Casing"):\n${offenders.map((o) => `  ${o}`).join('\n')}\n`
		).toEqual([]);
	});

	it('writes sentence case in the static Postmark templates', () => {
		const copy = templateCopy();
		expect(copy.length).toBeGreaterThan(0);

		const offenders = copy
			.map((entry) => ({ ...entry, words: titleCasedWords(entry.value) }))
			.filter((entry) => entry.words.length > 0)
			.map((entry) => `${entry.path}: ${JSON.stringify(entry.value)} — ${entry.words.join(', ')}`);

		expect(offenders).toEqual([]);
	});

	it('registers every notification type under a sentence-case label', () => {
		const offenders = NOTIFICATION_TYPES.filter((t) => titleCasedWords(t.label).length > 0).map(
			(t) => `${t.key}: ${JSON.stringify(t.label)}`
		);

		expect(offenders).toEqual([]);
	});
});
