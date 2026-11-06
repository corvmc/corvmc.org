import { RuleTester } from 'eslint';
import * as svelteParser from 'svelte-eslint-parser';
import tseslint from 'typescript-eslint';
import rule from './no-asserted-route-param.js';
// For its side effect: wires `RuleTester` to vitest.
import './rule-tester.js';

// The assertion is TypeScript syntax, so the script block needs the TS parser.
const tester = new RuleTester({
	languageOptions: {
		parser: svelteParser,
		parserOptions: { parser: tseslint.parser },
		ecmaVersion: 2022,
		sourceType: 'module'
	}
});
const script = (body: string) => `<script lang="ts">\n${body}\n</script>`;

tester.run('no-asserted-route-param', rule as never, {
	valid: [
		{ filename: 'a.svelte', code: script('const id = $derived(page.params.id ?? null);') },
		{ filename: 'a.svelte', code: script('const q = $derived(await get(params.slug));') },
		{ filename: 'a.svelte', code: script('const v = other.params.slug!;') }
	],
	invalid: [
		{
			filename: 'a.svelte',
			code: script('const q = $derived(await get(page.params.slug!));'),
			errors: [{ messageId: 'asserted' }]
		},
		{
			filename: 'a.svelte',
			code: script('const slug = $derived(page.params.slug!);'),
			errors: [{ messageId: 'asserted' }]
		}
	]
});
