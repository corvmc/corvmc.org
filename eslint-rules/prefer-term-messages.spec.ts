import { describe, expect, it } from 'vitest';
import catalog from '../messages/en.json';
import rule, { termForms } from './prefer-term-messages.js';
import { svelteRuleTester } from './rule-tester.js';

const tester = svelteRuleTester();
const options = [{ terms: ['term_band', 'term_member'] }];

tester.run('prefer-term-messages', rule as never, {
	valid: [
		// Prose containing the word is #2099's catalog, not a term label.
		{ filename: 'a.svelte', code: '<p>Book a room for your band</p>', options },
		{ filename: 'a.svelte', code: '<FormField name="band" label="Band name" />', options },
		// Not a user-facing attribute.
		{ filename: 'a.svelte', code: '<div class="members" data-kind="Band"></div>', options },
		// A term the options do not watch.
		{ filename: 'a.svelte', code: '<th>Events</th>', options },
		{ filename: 'a.svelte', code: "<script>const tab = { id: 'members' };</script>", options }
	],
	invalid: [
		{
			filename: 'a.svelte',
			code: '<th> Band </th>',
			options,
			errors: [{ messageId: 'term', data: { text: 'Band', key: 'term_band' } }]
		},
		{
			filename: 'a.svelte',
			code: '<PageHeader title="Members" />',
			options,
			errors: [{ messageId: 'term', data: { text: 'Members', key: 'term_member' } }]
		},
		{
			filename: 'a.svelte',
			code: "<script>const cols = [{ label: 'Bands' }];</script>",
			options,
			errors: [{ messageId: 'term', data: { text: 'Bands', key: 'term_band' } }]
		}
	]
});

describe('termForms', () => {
	it('reads both plural forms of every term in the catalog', () => {
		const forms = termForms(catalog, undefined);
		expect(forms.get('band')).toBe('term_band');
		expect(forms.get('bands')).toBe('term_band');
		expect(forms.get('external acts')).toBe('term_external_act');
		expect([...forms.values()].every((key) => key.startsWith('term_'))).toBe(true);
	});
});
