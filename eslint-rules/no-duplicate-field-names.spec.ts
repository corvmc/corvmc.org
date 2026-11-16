import rule from './no-duplicate-field-names.js';
import { svelteRuleTester } from './rule-tester.js';

const tester = svelteRuleTester();
const f = 'a.svelte';

tester.run('no-duplicate-field-names', rule as never, {
	valid: [
		{
			filename: f,
			code: '<Form remote={save}><FormField field={fields.title} /><FormField field={fields.body} /></Form>'
		},
		// A wrapper's own control: the pair submits once.
		{
			filename: f,
			code: '<Form remote={save}><FormField field={fields.lineup}><LineupEditor field={fields.lineup} /></FormField></Form>'
		}
	],
	invalid: [
		{
			filename: f,
			code: '<Form remote={save}><FormField field={fields.title} /><FormField field={fields.title} /></Form>',
			errors: [{ messageId: 'duplicateName' }]
		},
		{
			filename: f,
			code: '<Form remote={save}><FormField name="title" /><Field name="title" /></Form>',
			errors: [{ messageId: 'duplicateName' }]
		}
	]
});
