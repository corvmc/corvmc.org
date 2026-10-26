import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import rule from './no-tracked-command-in-effect.js';
import { svelteRuleTester } from './rule-tester.js';

// The rule reads the imported remote module to tell a command from a query, so
// the fixtures need one on disk beside the component.
const dir = mkdtempSync(join(tmpdir(), 'tracked-command-'));
writeFileSync(
	join(dir, 'chat.remote.ts'),
	[
		'export const markSeen = command(z.string(), async (id) => {});',
		'export const getTopic = query(z.string(), async (id) => {});'
	].join('\n')
);
const filename = join(dir, 'Chat.svelte');

const svelte = (body: string) =>
	`<script>\n\timport { untrack } from 'svelte';\n\timport { markSeen, getTopic as topic } from './chat.remote';\n\tlet { id } = $props();\n${body}\n</script>`;

svelteRuleTester().run('no-tracked-command-in-effect', rule as never, {
	valid: [
		{
			filename,
			code: svelte('$effect(() => { const x = id; untrack(() => void markSeen(x)); });')
		},
		// A query in an effect is not this problem, and untrack would drop its argument.
		{ filename, code: svelte('$effect(() => { void topic(id).refresh(); });') },
		// Deferred: a handler or continuation the effect sets up runs outside tracking.
		{
			filename,
			code: svelte('$effect(() => { const f = () => markSeen(id); window.onfocus = f; });')
		},
		{ filename, code: svelte('function onclick() { markSeen(id); }') }
	],
	invalid: [
		{
			filename,
			code: svelte('$effect(() => { void markSeen(id).catch(() => {}); });'),
			errors: [{ messageId: 'tracked' }]
		},
		{
			filename,
			code: svelte('$effect.pre(() => markSeen(id));'),
			errors: [{ messageId: 'tracked' }]
		},
		// An early-return guard only survives by luck; it is still the shape.
		{
			filename,
			code: svelte(
				'let marked;\n$effect(() => { if (marked === id) return; marked = id; void markSeen(id); });'
			),
			errors: [{ messageId: 'tracked' }]
		}
	]
});
