/** @typedef {import('./ast.js').RuleNode} RuleNode */
/**
 * A select field's top-level `sql` renders its columns unqualified on a query
 * with no join, so `${outer.id}` inside `(select … from ${inner} where …)`
 * reads as the inner table's own `"id"` and the count is wrong (#2788). A join
 * or a nested `sql` makes drizzle qualify them. Reports a column of a table not
 * named after `from` or `join` in the same template, on a chain with no join.
 */
const SUBQUERY = /\b(select|exists)\b/i;
const INNER_TABLE = /\b(from|join)\s*$/i;
const SELECTS = new Set(['select', 'selectDistinct']);

/** @param {RuleNode} call `db.select(…)`; true when a later call in its chain joins. */
const chainJoins = (call) => {
	let node = call;
	while (node.parent?.type === 'MemberExpression' && node.parent.object === node) {
		const member = node.parent;
		if (member.property.type === 'Identifier' && /Join$/.test(member.property.name)) return true;
		if (member.parent?.type !== 'CallExpression') return false;
		node = member.parent;
	}
	return false;
};

/** @param {RuleNode} node */
const isSelectField = (node) => {
	const property = node.parent;
	const object = property?.parent;
	const call = object?.parent;
	return (
		property?.type === 'Property' &&
		property.value === node &&
		object?.type === 'ObjectExpression' &&
		call?.type === 'CallExpression' &&
		call.arguments[0] === object &&
		call.callee.type === 'MemberExpression' &&
		call.callee.property.type === 'Identifier' &&
		SELECTS.has(call.callee.property.name) &&
		!chainJoins(call)
	);
};

/** @type {import('eslint').Rule.RuleModule} */
export default {
	meta: {
		type: 'problem',
		docs: { description: 'Qualify an outer column in a select field’s correlated subquery.' },
		messages: {
			unqualified:
				'`{{name}}` is rendered unqualified here and resolves to the subquery’s own table. ' +
				'Wrap the subquery in a nested sql`${sql`(select …)`}`, which drizzle qualifies.'
		}
	},
	create(context) {
		return {
			/** @param {RuleNode} node */
			TaggedTemplateExpression(node) {
				if (node.tag.type !== 'Identifier' || node.tag.name !== 'sql') return;
				const { quasis, expressions } = node.quasi;
				if (!quasis.some((q) => SUBQUERY.test(q.value.raw))) return;
				if (!isSelectField(node)) return;
				const inner = new Set();
				expressions.forEach((e, i) => {
					if (e.type === 'Identifier' && INNER_TABLE.test(quasis[i].value.raw)) inner.add(e.name);
				});
				for (const e of expressions) {
					if (
						e.type === 'MemberExpression' &&
						e.object.type === 'Identifier' &&
						!e.computed &&
						!inner.has(e.object.name)
					) {
						context.report({
							node: e,
							messageId: 'unqualified',
							data: { name: `${e.object.name}.${e.property.name}` }
						});
					}
				}
			}
		};
	}
};
