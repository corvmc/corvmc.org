/** @typedef {import('./ast.js').RuleNode} RuleNode */

/**
 * No `page.params.x!`; use `routeParams()` from `#lib/route-params.svelte.js`.
 *
 * `page.params` is global and changes while the outgoing page is still mounted,
 * so the assertion is false exactly when it matters: a query re-run from that page
 * is sent with no argument (#2472). A read that handles the missing value
 * (`page.params.id ?? null`) is not reported.
 */

/** @type {import('eslint').Rule.RuleModule} */
export default {
	meta: {
		type: 'problem',
		docs: { description: 'Disallow a non-null assertion on `page.params.x`.' },
		schema: [],
		messages: {
			asserted:
				'`page.params.{{name}}!` is undefined once the next route is applied, with this page still mounted. Use routeParams() from #lib/route-params.svelte.js.'
		}
	},
	create(context) {
		return {
			/** @param {RuleNode} node */
			TSNonNullExpression(node) {
				const member = node.expression;
				if (member?.type !== 'MemberExpression') return;
				const params = member.object;
				if (params?.type !== 'MemberExpression' || params.computed) return;
				if (params.object?.type !== 'Identifier' || params.object.name !== 'page') return;
				if (params.property?.name !== 'params') return;
				context.report({
					node,
					messageId: 'asserted',
					data: { name: member.property?.name ?? member.property?.value ?? '' }
				});
			}
		};
	}
};
