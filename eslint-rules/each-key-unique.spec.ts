import { RuleTester } from 'eslint';
import * as svelteParser from 'svelte-eslint-parser';
import ts from 'typescript-eslint';
import rule from './each-key-unique.js';
import './rule-tester.js';

// The rule reads types, so the tester runs the TypeScript project service over
// each case as an inferred project file.
const tester = new RuleTester({
	languageOptions: {
		parser: svelteParser,
		parserOptions: {
			parser: ts.parser,
			projectService: { allowDefaultProject: ['*.svelte'] },
			tsconfigRootDir: import.meta.dirname,
			extraFileExtensions: ['.svelte']
		}
	}
});

const component = (props: string, markup: string) => ({
	filename: `${import.meta.dirname}/case.svelte`,
	code: `<script lang="ts">
	type UniqueTags = readonly string[] & { readonly brand: true };
	let { list }: { list: ${props} } = $props();
</script>
${markup}`
});

tester.run('each-key-unique', rule as never, {
	valid: [
		component('UniqueTags', '{#each list as tag (tag)}{tag}{/each}'),
		component('string[]', '{#each list as tag, i (i)}{tag}{/each}'),
		component("readonly ('open' | 'closed')[]", '{#each list as s (s)}{s}{/each}'),
		component('number[]', '{#each list as n (n)}{n}{/each}'),
		component('{ id: string; name: string }[]', '{#each list as row (row.id)}{row.name}{/each}'),
		component('{ id: string }[]', '{#each list as row (row)}{row.id}{/each}')
	],
	invalid: [
		{
			...component('string[]', '{#each list as tag (tag)}{tag}{/each}'),
			errors: [{ messageId: 'selfKeyed' }]
		},
		{
			...component('readonly (string | null)[]', '{#each list as tag (tag)}{tag}{/each}'),
			errors: [{ messageId: 'selfKeyed' }]
		},
		{
			...component('UniqueTags', '{#each list.slice(1) as tag (tag)}{tag}{/each}'),
			errors: [{ messageId: 'selfKeyed' }]
		}
	]
});
