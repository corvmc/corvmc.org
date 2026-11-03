import rule from './no-svelte-element.js';
import { svelteRuleTester } from './rule-tester.js';

const tester = svelteRuleTester();

tester.run('no-svelte-element', rule as never, {
	valid: [
		{
			filename: 'a.svelte',
			code: '{#if level === 2}<h2 class="t">x</h2>{:else}<h3 class="t">x</h3>{/if}'
		},
		{ filename: 'a.svelte', code: '<svelte:head><title>x</title></svelte:head>' },
		{ filename: 'a.svelte', code: '<svelte:boundary><p>x</p></svelte:boundary>' }
	],
	invalid: [
		{
			filename: 'a.svelte',
			code: '<svelte:element this={`h${level}`} class="t">x</svelte:element>',
			errors: [{ messageId: 'svelteElement' }]
		},
		{
			filename: 'a.svelte',
			code: '<svelte:element this={tag}><input /></svelte:element>',
			errors: [{ messageId: 'svelteElement' }]
		}
	]
});
