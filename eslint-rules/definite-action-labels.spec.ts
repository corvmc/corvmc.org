import rule from './definite-action-labels.js';
import { svelteRuleTester } from './rule-tester.js';

const tester = svelteRuleTester();

tester.run('definite-action-labels', rule as never, {
	valid: [
		{ filename: 'a.svelte', code: '<Action label="Log hours" modalTitle="Log hours" />' },
		{
			filename: 'a.svelte',
			code: '<Action label="Ask an act" modalTitle="Ask an act for {title}" />'
		},
		// A form field's prompt is not an action label.
		{ filename: 'a.svelte', code: '<FormField name="notes" label="Anything else?" />' },
		// A default outside an *Action component is not an action label.
		{
			filename: 'Card.svelte',
			code: "<script>let { label = 'Anything else' } = $props();</script>"
		},
		{
			filename: 'LogHoursAction.svelte',
			code: "<script>let { label = 'Log hours' } = $props();</script>"
		}
	],
	invalid: [
		{
			filename: 'a.svelte',
			code: '<CreateSuggestionAction label="Suggest something" />',
			errors: [{ messageId: 'indefinite' }]
		},
		{
			filename: 'a.svelte',
			code: '<Action label="Ask an act" modalTitle="Ask for something for {title}" />',
			errors: [{ messageId: 'indefinite' }]
		},
		{
			filename: 'a.svelte',
			code: '<Button label="Invite anyone" />',
			errors: [{ messageId: 'indefinite' }]
		},
		{
			filename: 'LogHoursForMemberAction.svelte',
			code: "<script>let { label = 'Log hours for someone' } = $props();</script>",
			errors: [{ messageId: 'indefinite' }]
		}
	]
});
