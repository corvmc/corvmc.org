import rule from './club-time-dates.js';
import { svelteRuleTester, tsRuleTester } from './rule-tester.js';

const script = (body: string) => ({ filename: 'a.svelte', code: `<script>${body}</script>` });
const template = (expr: string) => ({ filename: 'a.svelte', code: `<p>{${expr}}</p>` });

svelteRuleTester().run('club-time-dates', rule as never, {
	valid: [
		script("d.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'long' });"),
		script("d.toLocaleTimeString('en-GB', { timeZone: DEFAULT_TIMEZONE, minute: '2-digit' });"),
		script('d.toLocaleDateString(undefined, opts);'),
		script("d.toLocaleDateString('en-US', { ...base });"),
		template('count.toLocaleString()'),
		template("price.toLocaleString(undefined, { style: 'currency', currency: 'USD' })"),
		template('new Date(x).toLocaleString(undefined, { timeZone: "UTC" })'),
		script('d.toISOString();'),
		script('d.toISOString().slice(0, 16);'),
		script("text.split('T')[0];")
	],
	invalid: [
		{ ...template('new Date(x).toLocaleDateString()'), errors: [{ messageId: 'noTimeZone' }] },
		{
			...script("d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });"),
			errors: [{ messageId: 'noTimeZone' }]
		},
		{ ...script("d.toLocaleTimeString('en-US');"), errors: [{ messageId: 'noTimeZone' }] },
		{ ...template('new Date(x).toLocaleString()'), errors: [{ messageId: 'noTimeZone' }] },
		{
			...template("value.toLocaleString('en-US', { month: 'short' })"),
			errors: [{ messageId: 'noTimeZone' }]
		},
		{ ...script('d.toISOString().slice(0, 10);'), errors: [{ messageId: 'isoSlice' }] },
		{ ...script('d.toISOString().substring(0, 10);'), errors: [{ messageId: 'isoSlice' }] },
		{ ...script("d.toISOString().split('T')[0];"), errors: [{ messageId: 'isoSlice' }] }
	]
});

tsRuleTester().run('club-time-dates (remote)', rule as never, {
	valid: [{ code: 'total.toLocaleString();' }],
	invalid: [
		{ code: 'const to = now.toISOString().slice(0, 10);', errors: [{ messageId: 'isoSlice' }] }
	]
});
