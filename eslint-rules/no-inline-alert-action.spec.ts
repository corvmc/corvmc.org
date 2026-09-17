import rule from './no-inline-alert-action.js';
import { svelteRuleTester } from './rule-tester.js';

const tester = svelteRuleTester();

tester.run('no-inline-alert-action', rule as never, {
	valid: [
		{
			filename: 'a.svelte',
			code: '<Alert>Text{#snippet action()}<Button>Go</Button>{/snippet}</Alert>'
		},
		// A layout element the page owns is arranging the button itself.
		{
			filename: 'a.svelte',
			code: '<Alert>Text<div class="flex"><Button>Go</Button></div></Alert>'
		},
		{ filename: 'a.svelte', code: '<Button>Go</Button>' }
	],
	invalid: [
		{
			filename: 'a.svelte',
			code: '<Alert>Leave the band?<Button>Leave</Button></Alert>',
			errors: [{ messageId: 'inline' }]
		},
		{
			filename: 'a.svelte',
			code: '<Alert>Sign in first<Action>Sign in</Action></Alert>',
			errors: [{ messageId: 'inline' }]
		}
	]
});
