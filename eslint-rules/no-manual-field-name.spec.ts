import rule from './no-manual-field-name.js';
import { svelteRuleTester } from './rule-tester.js';

const tester = svelteRuleTester();
const f = 'a.svelte';

tester.run('no-manual-field-name', rule as never, {
	valid: [
		{ filename: f, code: '<Form remote={save}><FormField field={save.fields.title} /></Form>' },
		{
			filename: f,
			code: "<Form remote={save}><input {...save.fields.id.as('hidden', id)} /></Form>"
		},
		{ filename: f, code: '<Form action={send}><FormField name="email" /></Form>' },
		{
			filename: f,
			code: '<Form action={send}><input type="hidden" name="id" value={id} /></Form>'
		},
		{
			filename: f,
			code: '<Form remote={save}><FormField name="slug" readonly value={slug} /></Form>'
		},
		{ filename: f, code: '<Form remote={save}><Icon name="x" /></Form>' },
		{ filename: f, code: '<form method="get"><input name="q" /></form>' },
		{ filename: f, code: '<FormField name="loose" />' },
		{
			filename: f,
			code: '<Action action={() => run()}>{#snippet body()}<input name="x" />{/snippet}</Action>'
		}
	],
	invalid: [
		{
			filename: f,
			code: '<Form remote={save}><FormField name="title" /></Form>',
			errors: [{ messageId: 'manualName' }]
		},
		{
			filename: f,
			code: '<Form remote={save.for(id)}><div><input type="hidden" name="id" value={id} /></div></Form>',
			errors: [{ messageId: 'manualName' }]
		},
		{
			filename: f,
			code: '<Form remote={save}><FormField name="slug" {readonly} /></Form>',
			errors: [{ messageId: 'manualName' }]
		},
		{
			filename: f,
			code: '<Form remote={save}><Field name="title" /><Form.Field name="body" /></Form>',
			errors: [{ messageId: 'manualName' }, { messageId: 'manualName' }]
		},
		{
			filename: f,
			code: '<Form remote={save}><button name="intent" value="a">go</button></Form>',
			errors: [{ messageId: 'manualName' }]
		},
		{
			filename: f,
			code: '<Action action={grant}>{#snippet form()}<Select name="role"><option /></Select>{/snippet}</Action>',
			errors: [{ messageId: 'manualName' }]
		},
		{
			filename: f,
			code: '<Action {action}>{#snippet form()}<input type="hidden" name="id" value={id} />{/snippet}</Action>',
			errors: [{ messageId: 'manualName' }]
		},
		{
			filename: f,
			code: '<form {...save.enhance(go)}><textarea name="body"></textarea></form>',
			errors: [{ messageId: 'manualName' }]
		},
		{
			filename: f,
			code: '<FormField name="loose" />',
			options: [{ outsideForm: true }],
			errors: [{ messageId: 'outsideForm' }]
		}
	]
});
