import rule from './no-asserted-route-param.js';
import { svelteRuleTester } from './rule-tester.js';

const tester = svelteRuleTester();
const script = (body: string) => `<script lang="ts">\n${body}\n</script>`;

tester.run('no-asserted-route-param', rule as never, {
	valid: [
		{ filename: 'a.svelte', code: script('const id = $derived(page.params.id ?? null);') },
		{ filename: 'a.svelte', code: script('const q = $derived(await get(params.slug));') },
		{ filename: 'a.svelte', code: script('const v = other.params.slug!;') }
	],
	invalid: [
		{
			filename: 'a.svelte',
			code: script('const q = $derived(await get(page.params.slug!));'),
			errors: [{ messageId: 'asserted' }]
		},
		{
			filename: 'a.svelte',
			code: script('const slug = $derived(page.params.slug!);'),
			errors: [{ messageId: 'asserted' }]
		}
	]
});
