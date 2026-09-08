import { describe, it, expect } from 'vitest';
import { globSync, readFileSync } from 'node:fs';

/**
 * `pnpm email:validate` runs Postmark's Mustachio over these files and says
 * nothing about their markup — #635 shipped a receipt whose `{{#splitShown}}`
 * rows sat after the inner `</table>` and it validated clean. A browser
 * foster-parents rows like that into the enclosing table and Outlook's Word
 * engine may drop them outright, so the damage only shows in a rendered email.
 * This reads the source instead.
 */
const TEMPLATES = globSync('postmark/templates/**/content.html').sort();

/** No end tag in HTML. `<br />` also closes itself explicitly. */
const VOID = new Set([
	'area',
	'base',
	'br',
	'col',
	'embed',
	'hr',
	'img',
	'input',
	'link',
	'meta',
	'param',
	'source',
	'track',
	'wbr'
]);

/** Table parts a parser relocates rather than rejects when they are misplaced. */
const REQUIRED_PARENT: Record<string, string[]> = {
	tr: ['table', 'tbody', 'thead', 'tfoot'],
	td: ['tr'],
	th: ['tr'],
	tbody: ['table'],
	thead: ['table'],
	tfoot: ['table']
};

/**
 * Blank out everything that is not markup — comments (the `<!--[if mso]>`
 * block included), `<style>` bodies, the doctype and every mustache tag.
 * Newlines are kept so reported line numbers still point at the source.
 */
function stripNonMarkup(source: string): string {
	const blank = (match: string) => match.replace(/[^\n]/g, '');
	return source
		.replace(/<!--[\s\S]*?-->/g, blank)
		.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, blank)
		.replace(/<!DOCTYPE[^>]*>/gi, blank)
		.replace(/\{\{\{[^{}]*\}\}\}|\{\{[^{}]*\}\}/g, blank);
}

const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g;

/** Every nesting fault in one template, as `line: what is wrong` strings. */
export function nestingFaults(source: string): string[] {
	const markup = stripNonMarkup(source);
	const open: { tag: string; line: number }[] = [];
	const faults: string[] = [];
	const lineAt = (index: number) => markup.slice(0, index).split('\n').length;

	for (const match of markup.matchAll(TAG)) {
		const [, closing, name, selfClosing] = match;
		const tag = name.toLowerCase();
		const line = lineAt(match.index);

		if (closing) {
			const top = open.pop();
			if (!top) faults.push(`${line}: </${tag}> closes nothing`);
			else if (top.tag !== tag)
				faults.push(`${line}: </${tag}> closes <${top.tag}> opened on line ${top.line}`);
			continue;
		}
		if (VOID.has(tag) || selfClosing) continue;

		const allowed = REQUIRED_PARENT[tag];
		const parent = open.at(-1)?.tag ?? 'nothing';
		if (allowed && !allowed.includes(parent))
			faults.push(`${line}: <${tag}> sits in <${parent}>, not in ${allowed.join('/')}`);

		open.push({ tag, line });
	}

	for (const unclosed of open) faults.push(`${unclosed.line}: <${unclosed.tag}> is never closed`);
	return faults;
}

describe('postmark html templates', () => {
	it('finds the templates to check', () => {
		// describe.each over an empty list is a silently passing no-op.
		expect(TEMPLATES.length).toBeGreaterThan(0);
	});
});

describe.each(TEMPLATES)('%s', (file) => {
	it('nests every tag where a parser will leave it', () => {
		expect(nestingFaults(readFileSync(file, 'utf8'))).toEqual([]);
	});
});

describe('the check itself', () => {
	it('catches the #635 shape — rows left outside the table they belong to', () => {
		const inner = '<table><tr><td>a</td></tr></table>';
		const orphaned = `<table><tr><td>${inner}<tr><td>b</td></tr></td></tr></table>`;
		expect(nestingFaults(orphaned)).not.toEqual([]);
	});

	it('passes the same rows once they are back inside the inner table', () => {
		const inner = '<table><tr><td>a</td></tr><tr><td>b</td></tr></table>';
		expect(nestingFaults(`<table><tr><td>${inner}</td></tr></table>`)).toEqual([]);
	});
});
