import rule from './no-wording-locators.js';
import { tsRuleTester } from './rule-tester.js';

const tester = tsRuleTester();

tester.run('no-wording-locators', rule as never, {
	valid: [
		// Structure: a role with no name, scoped to its container.
		"page.getByRole('dialog').getByRole('button');",
		"dialog.locator('button[type=submit]');",
		'page.locator(\'a[href="/events"]\');',
		"page.locator('input[name=title]');",
		// The accessible contract of a form field stays allowed.
		"page.getByLabel('Email');",
		// A name from fixtures or config, not prose written into the spec.
		"page.getByRole('row', { name: SEED_BAND.name });",
		'page.getByRole("button", { name: `Edit ${title}` });',
		'screen.getByText(labels.repair_out);',
		'expect(cell).toHaveTextContent(String(total));',
		// Options other than the name.
		"page.getByRole('checkbox', { checked: true });"
	],
	invalid: [
		{
			code: "page.getByRole('button', { name: 'Save' });",
			errors: [{ messageId: 'roleName' }]
		},
		{
			code: "page.getByRole('heading', { name: /members/i });",
			errors: [{ messageId: 'roleName' }]
		},
		{
			code: "screen.getByRole('link', { name: `Profile`, exact: true });",
			errors: [{ messageId: 'roleName' }]
		},
		{ code: "page.getByText('Pickup scheduled');", errors: [{ messageId: 'text' }] },
		{ code: 'getByText(/no results/i);', errors: [{ messageId: 'text' }] },
		{
			code: "expect(el).toHaveTextContent('Saved');",
			errors: [{ messageId: 'textAssertion' }]
		},
		{
			code: "expect(row).toContainText('Paid');",
			errors: [{ messageId: 'textAssertion' }]
		},
		{
			code: 'expect(h1).not.toHaveText(/draft/);',
			errors: [{ messageId: 'textAssertion' }]
		}
	]
});
