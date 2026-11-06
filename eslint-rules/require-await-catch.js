/** @typedef {import('./ast.js').RuleNode} RuleNode */

/**
 * Every `{#await}` block has a `{:catch}`.
 *
 * With no catch branch a rejected promise renders nothing, and Svelte rethrows it
 * as an unhandled rejection that no `<svelte:boundary>` catches, so a failed query
 * reads as an empty section (#2453, #2459). A `{:catch}` holding only a comment
 * says blank is the right failure (`block_empty` warns on one holding nothing); to
 * reach the panel's boundary, use a top-level `await` instead of a block.
 */

/** @type {import('eslint').Rule.RuleModule} */
export default {
	meta: {
		type: 'problem',
		docs: {
			description: 'Require a `{:catch}` branch on every `{#await}` block.'
		},
		schema: [],
		messages: {
			noCatch:
				'`{#await}` with no `{:catch}` renders nothing when the promise rejects, and no boundary sees it (#2459). Add a `{:catch}`, or use a top-level `await` to reach the panel boundary.'
		}
	},
	create(context) {
		return {
			/** @param {RuleNode} node */
			SvelteAwaitBlock(node) {
				if (!node.catch) context.report({ node, messageId: 'noCatch' });
			}
		};
	}
};
