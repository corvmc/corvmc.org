import rule from './no-literal-ui-text.js';
import { svelteRuleTester } from './rule-tester.js';

const tester = svelteRuleTester();
const literal = [{ messageId: 'literal' }];

tester.run('no-literal-ui-text', rule as never, {
	valid: [
		{ filename: 'a.svelte', code: '<p>{m.room_booked()}</p>' },
		{ filename: 'a.svelte', code: '<Button label={m.common_save()} />' },
		// Glyphs, numbers and entities are not copy.
		{ filename: 'a.svelte', code: '<span>·</span><span>&times;</span><span>42</span>' },
		{ filename: 'a.svelte', code: '<span aria-hidden="true">Esc</span><kbd>Ctrl</kbd>' },
		// Not a copy attribute or property.
		{ filename: 'a.svelte', code: '<div class="text-sm" data-kind="Band" name="title"></div>' },
		{ filename: 'a.svelte', code: "<script>const tab = { id: 'members' };</script>" },
		{ filename: 'a.svelte', code: '<style>.a { color: red; }</style>' },
		// A <style> in <svelte:head> is CSS, not copy.
		{
			filename: 'a.svelte',
			code: '<svelte:head><style>@media print { a { color: red; } }</style></svelte:head>'
		},
		// A variable that never reaches the page is not interface copy.
		{ filename: 'a.svelte', code: "<script>const kind = 'band';</script><p>{m.x({ kind })}</p>" },
		{ filename: 'a.svelte', code: '<p>{count}</p>' },
		{ filename: 'a.svelte', code: '<p>CorvMC</p>', options: [{ allow: ['CorvMC'] }] }
	],
	invalid: [
		{
			filename: 'a.svelte',
			code: "<p>{open ? 'Hide' : 'Show'}</p>",
			errors: [...literal, ...literal]
		},
		{ filename: 'a.svelte', code: "<p>{name ?? 'Someone'}</p>", errors: literal },
		{
			filename: 'a.svelte',
			code: "<script>const label = $derived(open ? 'Hide' : 'Show');</script><p>{label}</p>",
			errors: [...literal, ...literal]
		},
		{
			filename: 'a.svelte',
			code: "<script>const hint = 'Pick one';</script><Field label={hint} />",
			errors: literal
		},
		{ filename: 'a.svelte', code: '<CrossRefList note="3 active" />', errors: literal },
		{ filename: 'a.svelte', code: '<p>Book a room</p>', errors: literal },
		{ filename: 'a.svelte', code: '<PageHeader title="Members" />', errors: literal },
		{ filename: 'a.svelte', code: '<Action successToast="Saved" />', errors: literal },
		{ filename: 'a.svelte', code: '<input aria-label="{name} share" />', errors: literal },
		{
			filename: 'a.svelte',
			code: "<Button label={open ? 'Hide' : 'Show'} />",
			errors: [{ messageId: 'literal' }, { messageId: 'literal' }]
		},
		{
			filename: 'a.svelte',
			code: "<script>const tabs = [{ label: 'All' }];</script>",
			errors: literal
		},
		{
			filename: 'a.svelte',
			code: '<script>toast.success(`Saved ${n}`);</script>',
			errors: literal
		},
		{
			filename: 'a.svelte',
			code: "<script>let { title = 'Untitled' } = $props();</script>",
			errors: literal
		}
	]
});
