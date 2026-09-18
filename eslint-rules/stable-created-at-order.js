/** @typedef {import('./ast.js').RuleNode} RuleNode */
/**
 * `created_at` defaults to `(unixepoch())` — whole seconds. Two rows written in
 * the same second tie, and an `orderBy` that ends there names no tiebreaker, so
 * their order is whatever the plan happens to give. #1196 found it when adding
 * index replay to the spec harness flipped a list that nothing about the
 * product had changed.
 */

/**
 * @param {RuleNode} node
 * @returns {boolean} annotated because the recursion below makes the inferred
 * return type circular, which `checkJs` reports as an error.
 */
function endsInCreatedAt(node) {
	// `asc(x.createdAt)` / `desc(x.createdAt)`
	if (
		node.type === 'CallExpression' &&
		node.callee.type === 'Identifier' &&
		(node.callee.name === 'asc' || node.callee.name === 'desc')
	) {
		return node.arguments.length === 1 && endsInCreatedAt(node.arguments[0]);
	}
	// A bare `x.createdAt`, which drizzle reads as ascending.
	return (
		node.type === 'MemberExpression' &&
		node.property.type === 'Identifier' &&
		/^(createdAt|created_at)$/.test(node.property.name)
	);
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
	meta: {
		type: 'problem',
		fixable: 'code',
		docs: {
			description:
				'An orderBy whose last key is created_at has no defined order for rows written in the same second.'
		},
		messages: {
			unstable:
				'`created_at` is whole seconds, so rows written in the same second tie and this order ' +
				'is undefined. Add a unique tiebreaker after it — `{{suggestion}}`.'
		}
	},
	create(context) {
		return {
			CallExpression(node) {
				if (
					node.callee.type !== 'MemberExpression' ||
					node.callee.property.type !== 'Identifier' ||
					node.callee.property.name !== 'orderBy' ||
					node.arguments.length === 0
				) {
					return;
				}

				const last = node.arguments[node.arguments.length - 1];
				if (last.type === 'SpreadElement' || !endsInCreatedAt(last)) return;

				// Name the table from the key itself, so the message is copy-pasteable.
				const inner = last.type === 'CallExpression' ? last.arguments[0] : last;
				const table =
					inner.type === 'MemberExpression' && inner.object.type === 'Identifier'
						? inner.object.name
						: 'table';
				const direction =
					last.type === 'CallExpression' && last.callee.type === 'Identifier'
						? last.callee.name
						: 'asc';

				const tiebreaker = `${direction}(${table}.id)`;
				context.report({
					node: last,
					messageId: 'unstable',
					data: { suggestion: tiebreaker },
					// Every table reached this way has an `id` primary key, and the id
					// is a random UUID — arbitrary, which is the point: the order only
					// has to be the same twice, not mean anything.
					fix: (fixer) =>
						table === 'table' ? null : fixer.insertTextAfter(last, `, ${tiebreaker}`)
				});
			}
		};
	}
};
