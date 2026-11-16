import rule from './no-raw-file-input.js';
import { svelteRuleTester } from './rule-tester.js';

const tester = svelteRuleTester();

tester.run('no-raw-file-input', rule as never, {
	valid: [
		{ filename: 'a.svelte', code: '<FileUpload upload={send} accept="image/*" />' },
		{ filename: 'a.svelte', code: '<FormField field={fields.poster} type="file" />' },
		{ filename: 'a.svelte', code: '<input type="text" name="title" />' },
		{ filename: 'a.svelte', code: "<input {...fields.id.as('hidden', id)} />" }
	],
	invalid: [
		{
			filename: 'a.svelte',
			code: '<input type="file" accept="image/*" onchange={send} />',
			errors: [{ messageId: 'rawFileInput' }]
		},
		{
			filename: 'a.svelte',
			code: "<input {...fields.posterFile.as('file')} />",
			errors: [{ messageId: 'rawFileInput' }]
		}
	]
});
