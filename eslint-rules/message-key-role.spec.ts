import rule from './message-key-role.js';
import { svelteRuleTester, tsRuleTester } from './rule-tester.js';

const tester = svelteRuleTester();
const role = [{ messageId: 'role' }];
const imports = "<script>import { m } from '$lib/paraglide/messages.js';</script>";
const svelte = (template: string) => ({ filename: 'a.svelte', code: `${imports}${template}` });

tester.run('message-key-role', rule as never, {
	valid: [
		svelte('<Button label={m.x_save_label()} />'),
		svelte('<Modal modalTitle={m.x_delete_band_title()} submitLabel={m.x_delete_label()} />'),
		svelte('<Field checkboxLabel={m.x_notify_checkbox()} placeholder={m.x_name_placeholder()} />'),
		svelte('<Action successToast={m.x_saved_toast()} description={m.x_help_body()} />'),
		// A native element's title is a tooltip, which is a label.
		svelte('<span title={m.x_unread_label()}></span>'),
		// Either branch of a choice, and a message picked before it is called.
		svelte('<Button label={open ? m.x_hide_label() : m.x_show_label()} />'),
		svelte('<Button label={(open ? m.x_hide_label : m.x_show_label)({ n })} />'),
		// A message's inputs are fragments of its sentence, whatever they are named.
		svelte('<p title={m.x_by_label({ title: m.x_name_text() })}></p>'),
		// Terms are concepts, exempt from the suffix.
		svelte('<Button label={m.term_band({ count: 1 })} />'),
		// Not a copy prop: nothing to check.
		svelte('<p>{m.x_anything_text()}</p><Foo status={m.x_open_text()} />'),
		// `m` shadowed by a local is not the catalog.
		svelte('<Select options={list.map((m) => ({ value: m.id, label: m.name }))} />')
	],
	invalid: [
		{ ...svelte('<Button label={m.x_save()} />'), errors: role },
		{ ...svelte('<Modal modalTitle={m.x_delete_label()} />'), errors: role },
		{ ...svelte('<span title={m.x_unread_title()}></span>'), errors: role },
		{ ...svelte('<Button label={open ? m.x_hide_label() : m.x_show()} />'), errors: role },
		{
			filename: 'a.svelte',
			code: "<script>import { m } from '$lib/paraglide/messages.js'; let { emptyLabel = m.x_none_label() } = $props();</script>",
			errors: role
		}
	]
});

const head = "import { m as msg } from '$lib/paraglide/messages.js';";

tsRuleTester().run('message-key-role in a module', rule as never, {
	valid: [
		{
			code: `${head} toast.success(msg.x_saved_toast()); const nav = [{ label: msg.x_home_label() }];`
		}
	],
	invalid: [
		{
			code: `${head} const nav = [{ label: msg.x_home() }]; toast.error(msg.x_failed_text());`,
			errors: [...role, ...role]
		}
	]
});
