/** @typedef {import('./ast.js').RuleNode} RuleNode */

/** @type {import('eslint').Rule.RuleModule} */
export default {
	meta: {
		type: 'suggestion',
		docs: {
			description:
				'Disallow raw <form> elements in route page files. Use the Form component instead.'
		},
		messages: {
			noRawForm:
				'Use the <Form> component from $lib/components/ui/Form/ instead of raw <form> elements. See docs/development/ui-patterns.md.'
		}
	},
	create(context) {
		const filename = context.filename;
		if (!filename.includes('+page.svelte')) return {};

		return {
			/** @param {RuleNode} node */
			SvelteElement(node) {
				if (node.name?.name === 'form') {
					context.report({ node, messageId: 'noRawForm' });
				}
			}
		};
	}
};
