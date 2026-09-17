import rule from './no-clipped-row-action.js';
import { svelteRuleTester } from './rule-tester.js';

const tester = svelteRuleTester();

const td = (inner: string) => `<table><tbody><tr>${inner}</tr></tbody></table>`;

tester.run('no-clipped-row-action', rule as never, {
	valid: [
		{ filename: 'a.svelte', code: td('<td class="w-px"><Button href="/x">Go</Button></td>') },
		{
			filename: 'a.svelte',
			code: td('<td class="w-px"><div class="flex w-max gap-1"><Button>Go</Button></div></td>')
		},
		// A tiered cell with no action in it is exactly what the tier is for.
		{ filename: 'a.svelte', code: td('<td class="col-extra"><CopyableId value={id} /></td>') }
	],
	invalid: [
		{
			filename: 'a.svelte',
			code: td('<td class="col-extra"><Button href="/x">View reservation</Button></td>'),
			errors: [{ messageId: 'tiered' }]
		},
		{
			filename: 'a.svelte',
			code: td('<td class="col-support"><Action label="Approve" /></td>'),
			errors: [{ messageId: 'tiered' }]
		},
		{
			filename: 'a.svelte',
			code: td('<td><div class="flex justify-end gap-1"><Button>Receipt</Button></div></td>'),
			errors: [{ messageId: 'collapsed' }]
		}
	]
});
