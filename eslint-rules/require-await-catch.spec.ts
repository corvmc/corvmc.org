import rule from './require-await-catch.js';
import { svelteRuleTester } from './rule-tester.js';

const tester = svelteRuleTester();

tester.run('require-await-catch', rule as never, {
	valid: [
		{ filename: 'a.svelte', code: '{#await p then v}{v}{:catch e}{e}{/await}' },
		{ filename: 'a.svelte', code: '{#await p}<i></i>{:then v}{v}{:catch}<!-- why -->{/await}' },
		{ filename: 'a.svelte', code: '{#await p}<i></i>{:catch e}{e}{/await}' },
		{ filename: 'a.svelte', code: '{#await p catch e}{e}{/await}' }
	],
	invalid: [
		{
			filename: 'a.svelte',
			code: '{#await p then v}{v}{/await}',
			errors: [{ messageId: 'noCatch' }]
		},
		{
			filename: 'a.svelte',
			code: '{#await p}<i></i>{:then v}{v}{/await}',
			errors: [{ messageId: 'noCatch' }]
		},
		{ filename: 'a.svelte', code: '{#await p}<i></i>{/await}', errors: [{ messageId: 'noCatch' }] },
		// The inner one still rethrows, whatever the outer does.
		{
			filename: 'a.svelte',
			code: '{#await p then v}{#await q then w}{w}{/await}{:catch}{/await}',
			errors: [{ messageId: 'noCatch' }]
		}
	]
});
