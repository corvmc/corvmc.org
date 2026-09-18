import rule from './page-header-width-matches-content.js';
import { svelteRuleTester } from './rule-tester.js';

const tester = svelteRuleTester();

tester.run('page-header-width-matches-content', rule as never, {
	valid: [
		{ filename: 'a.svelte', code: '<PageHeader title="A" /><PageContent>x</PageContent>' },
		{
			filename: 'a.svelte',
			code: '<PageHeader title="A" width="2xl" /><PageContent width="2xl">x</PageContent>'
		},
		// A dynamic width on either side is the page's own business.
		{
			filename: 'a.svelte',
			code: '<PageHeader title="A" width={w} /><PageContent width="2xl">x</PageContent>'
		},
		// A page with no PageContent has nothing to align to.
		{ filename: 'a.svelte', code: '<PageHeader title="A" width="md" />' }
	],
	invalid: [
		{
			filename: 'a.svelte',
			code: '<PageHeader title="A" /><PageContent width="2xl">x</PageContent>',
			errors: [{ messageId: 'mismatch' }]
		},
		{
			filename: 'a.svelte',
			code: '<PageHeader title="A" width="md" /><PageContent width="3xl">x</PageContent>',
			errors: [{ messageId: 'mismatch' }]
		},
		{
			filename: 'a.svelte',
			code: '<PageHeader title="A" width="md" /><PageContent>x</PageContent>',
			errors: [{ messageId: 'mismatch' }]
		}
	]
});
