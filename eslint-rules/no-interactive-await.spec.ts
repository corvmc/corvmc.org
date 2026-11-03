import rule from './no-interactive-await.js';
import { svelteRuleTester } from './rule-tester.js';

const tester = svelteRuleTester();

tester.run('no-interactive-await', rule as never, {
	valid: [
		// Read-only markup losing its DOM for a round trip is harmless.
		{ filename: 'a.svelte', code: '{#await p then v}<p>{v}</p>{/await}' },
		{ filename: 'a.svelte', code: '{#await p}<span class="loading"></span>{/await}' },
		{ filename: 'a.svelte', code: '{#if v}<UpdateClosureAction />{/if}' },
		{ filename: 'a.svelte', code: '{#await p then v}<Button>Go</Button>{/await}' }
	],
	invalid: [
		{
			filename: 'a.svelte',
			code: '{#await p then v}<UpdateClosureAction closure={v} />{/await}',
			errors: [{ messageId: 'interactive' }]
		},
		{
			filename: 'a.svelte',
			code: '{#await p then v}<ResolveModal unresolved={v} />{/await}',
			errors: [{ messageId: 'interactive' }]
		},
		{
			filename: 'a.svelte',
			code: '{#await p then v}<div><input name="q" /></div>{/await}',
			errors: [{ messageId: 'interactive' }]
		},
		// One report per block, however many controls it holds.
		{
			filename: 'a.svelte',
			code: '{#await p then v}<Form><FormField name="a" /><FormField name="b" /></Form>{/await}',
			errors: [{ messageId: 'interactive' }]
		},
		{
			filename: 'a.svelte',
			code: '{#await p}<FormField name="a" />{:then v}{v}{/await}',
			errors: [{ messageId: 'interactive' }]
		}
	]
});
