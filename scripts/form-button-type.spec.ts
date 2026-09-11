import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { sourceFiles } from './lib/source-files';

/**
 * A `<Button>` inside a `<Form>` with no `type` submits it.
 *
 * `Button` sets no type of its own, so the HTML default applies. That has cost
 * twice: four Stripe checkout buttons with no pending state, double-clickable
 * into two sessions (#1075), and a Cancel that saved the form on its way out.
 * `SubmitButton` for the submit; `type="button"` for everything else.
 */
const FORM_BLOCK = /<Form\b[\s\S]*?<\/Form>/g;
const BUTTON_TAG = /<Button\b[^>]*?>/g;

/**
 * Comments blanked, spaces kept so every offset still lines up. A `<Button>`
 * written in a sentence *about* this trap is not one — `StaffUserForm` has
 * exactly that, documenting the rule this enforces.
 */
function withoutComments(source: string): string {
	return source.replace(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (c) =>
		c.replace(/[^\n]/g, ' ')
	);
}

function offenders(file: string): string[] {
	const source = withoutComments(readFileSync(file, 'utf8'));
	const found: string[] = [];

	for (const block of source.matchAll(FORM_BLOCK)) {
		for (const tag of block[0].matchAll(BUTTON_TAG)) {
			// `href` makes it a link, which never submits.
			if (/\btype=|\bhref=/.test(tag[0])) continue;
			const line = source.slice(0, block.index + tag.index).split('\n').length;
			found.push(`${file}:${line}`);
		}
	}
	return found;
}

describe('buttons inside a form', () => {
	it('never leaves one able to submit by accident', () => {
		const all = sourceFiles(['src/**/*.svelte'], new Set()).flatMap(offenders);

		expect(all).toEqual([]);
	});
});
