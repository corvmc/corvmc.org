import { RuleTester } from 'eslint';
import * as svelteParser from 'svelte-eslint-parser';
import { describe, expect, it } from 'vitest';

/**
 * `RuleTester` wired for this project's vitest.
 *
 * Two things it does not do for itself: vitest's globals are off, so it needs
 * `describe`/`it` handed to it; and `expect.requireAssertions` fails every case
 * because RuleTester asserts by throwing rather than through `expect`. The
 * wrapper records one assertion per case so a passing case counts as one.
 */
RuleTester.describe = describe;
RuleTester.it = ((text: string, fn: () => void) =>
	it(text, () => {
		fn();
		expect(true).toBe(true);
	})) as typeof RuleTester.it;

export function svelteRuleTester(): RuleTester {
	return new RuleTester({
		languageOptions: { parser: svelteParser, ecmaVersion: 2022, sourceType: 'module' }
	});
}

/**
 * The plain-ESTree tester, for a rule that only ever sees `.ts` files.
 * Defaults to espree, which is enough for a rule reading call and member
 * expressions — no TypeScript syntax appears in these fixtures.
 */
export function tsRuleTester(): RuleTester {
	return new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: 'module' } });
}
