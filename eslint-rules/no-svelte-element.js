/** @typedef {import('./ast.js').RuleNode} RuleNode */

/**
 * No `<svelte:element>`; branch over literal elements with `{#if}` instead.
 *
 * Svelte 5.57 hydrates one inside an async-gated block (template below a
 * top-level `await`) by re-inserting the server-rendered node, which blurs
 * anything focused inside it (#2224, #2300). Literal elements hydrate in place.
 */

/** @type {import('eslint').Rule.RuleModule} */
export default {
	meta: {
		type: 'problem',
		docs: { description: 'Disallow `<svelte:element>`.' },
		schema: [],
		messages: {
			svelteElement:
				'Branch over literal elements with {#if} instead of `<svelte:element>`: hydrating it below a top-level await re-inserts the node and drops focus (#2300).'
		}
	},
	create(context) {
		return {
			/** @param {RuleNode} node */
			SvelteElement(node) {
				if (node.kind === 'special' && node.name?.name === 'svelte:element') {
					context.report({ node: node.startTag ?? node, messageId: 'svelteElement' });
				}
			}
		};
	}
};
