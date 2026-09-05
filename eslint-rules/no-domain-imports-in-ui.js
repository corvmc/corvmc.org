/**
 * `src/lib/components/ui/` is the design system: primitives that take everything
 * through props and know nothing about this app's domains. That is what makes them
 * safe to reach for from anywhere.
 *
 * The `components/shared/` folder this replaced had no such rule, so it accumulated
 * both primitives and feature components until "is it shared?" stopped having an
 * answer.
 * This rule is what stops `ui/` going the same way: a component that needs data
 * belongs in `components/layout/` (the app frame) or in its domain folder.
 */

/** @type {import('eslint').Rule.RuleModule} */
export default {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Disallow $lib/remote and $lib/server imports inside src/lib/components/ui/, which must stay domain-free.'
		},
		messages: {
			domainImport:
				"'{{source}}' makes this a domain component, so it does not belong in components/ui/. Move it to components/<domain>/, or to components/layout/ if a +layout.svelte mounts it to frame pages."
		}
	},
	create(context) {
		/**
		 * @param {import('eslint').Rule.Node} node
		 * @param {unknown} source the import specifier, which is only a string on a literal
		 */
		const check = (node, source) => {
			if (typeof source !== 'string') return;
			if (/^\$lib\/(remote|server)\b/.test(source)) {
				context.report({ node, messageId: 'domainImport', data: { source } });
			}
		};

		return {
			ImportDeclaration(node) {
				check(node, node.source.value);
			},
			ImportExpression(node) {
				if (node.source.type === 'Literal') check(node, node.source.value);
			}
		};
	}
};
