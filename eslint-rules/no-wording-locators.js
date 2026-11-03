/** @typedef {import('./ast.js').RuleNode} RuleNode */

/**
 * A test locates an element by structure and asserts what happened, not the
 * copy (#2189). Flags a literal accessible name in `getByRole`, a literal
 * `getByText`, and a literal text-content assertion. A variable or a config
 * label is not flagged: only prose written into the spec itself.
 */

const TEXT_ASSERTIONS = new Set(['toHaveTextContent', 'toContainText', 'toHaveText']);

/** A string, regex, or interpolation-free template literal. */
function isWording(/** @type {RuleNode} */ node) {
	if (!node) return false;
	if (node.type === 'Literal') return typeof node.value === 'string' || Boolean(node.regex);
	return node.type === 'TemplateLiteral' && node.expressions.length === 0;
}

/** The called name: `getByRole(...)` or `x.getByRole(...)`. */
function calleeName(/** @type {RuleNode} */ callee) {
	if (callee.type === 'Identifier') return callee.name;
	if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier')
		return callee.property.name;
	return null;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
	meta: {
		type: 'suggestion',
		docs: { description: 'Locate and assert by structure, not UI wording.' },
		schema: [],
		messages: {
			roleName:
				'A literal `name:` ties this locator to the copy. Scope the role to its dialog, form or row, or use type, href, input name or aria state.',
			text: '`getByText` with a literal ties this test to the copy. Locate by structure and assert state.',
			textAssertion:
				'`{{ name }}` with a literal asserts the copy. Assert URL, value, count, visibility or a DB row.'
		}
	},
	create(context) {
		return {
			/** @param {RuleNode} node */
			CallExpression(node) {
				const name = calleeName(node.callee);
				const [first, second] = node.arguments;
				if (name === 'getByRole' && second?.type === 'ObjectExpression') {
					const prop = second.properties.find(
						(/** @type {RuleNode} */ p) =>
							p.type === 'Property' && !p.computed && p.key.name === 'name'
					);
					if (prop && isWording(prop.value))
						context.report({ node: prop.value, messageId: 'roleName' });
				} else if (name === 'getByText' && isWording(first)) {
					context.report({ node: first, messageId: 'text' });
				} else if (name && TEXT_ASSERTIONS.has(name) && isWording(first)) {
					context.report({ node: first, messageId: 'textAssertion', data: { name } });
				}
			}
		};
	}
};
