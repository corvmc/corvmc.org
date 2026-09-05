/** @typedef {import('./ast.js').RuleNode} RuleNode */

/**
 * If a query is composed into another query, refreshing it alone repaints nothing.
 *
 * A load-bearing query that assembles others on the server (see
 * `custom/no-concurrent-remote-queries`) leaves every existing
 * `constituent(...).refresh()` pointing at something no component reads any
 * more. The page keeps rendering whatever the wrapper returned, so a save
 * appears to do nothing — it does not throw, and a test only catches it if it
 * asserts on the screen after the mutation. Converting two pages in one sitting
 * left eight of these behind; end-to-end tests caught five.
 *
 * Reported rather than auto-fixed because both refreshes are sometimes right:
 * a constituent that another page still reads directly needs its own refresh as
 * well as the wrapper's, not instead of it.
 *
 * Scoped to a single file, which is where the composition and the mutations
 * that refresh it almost always live together.
 */

/** @type {import('eslint').Rule.RuleModule} */
export default {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Refreshing a query that is composed into another repaints nothing on its own; refresh the query components actually read.'
		},
		messages: {
			composed:
				'`{{inner}}` is composed into `{{outer}}`, so anything reading `{{outer}}` will not repaint from this. Refresh `{{outer}}` here too — or instead, if nothing reads `{{inner}}` directly any more.'
		}
	},
	create(context) {
		return {
			Program(program) {
				/** Exported query names in this file → the node holding their body. */
				const queries = new Map();

				for (const stmt of program.body) {
					const decl = stmt.type === 'ExportNamedDeclaration' ? stmt.declaration : null;
					if (!decl || decl.type !== 'VariableDeclaration') continue;
					for (const d of decl.declarations) {
						if (
							d.id.type === 'Identifier' &&
							d.init?.type === 'CallExpression' &&
							d.init.callee.type === 'Identifier' &&
							d.init.callee.name === 'query'
						) {
							queries.set(d.id.name, d.init);
						}
					}
				}

				/** constituent name → the query that wraps it. */
				const wrappedBy = new Map();

				/** @param {RuleNode} node @param {(n: RuleNode) => void} visit */
				const walk = (node, visit) => {
					if (!node || typeof node.type !== 'string') return;
					visit(node);
					for (const key of Object.keys(node)) {
						if (key === 'parent') continue;
						const child = node[key];
						if (Array.isArray(child)) child.forEach((c) => walk(c, visit));
						else if (child && typeof child.type === 'string') walk(child, visit);
					}
				};

				for (const [outer, node] of queries) {
					walk(node, (/** @type {RuleNode} */ n) => {
						if (
							n.type === 'CallExpression' &&
							n.callee.type === 'Identifier' &&
							n.callee.name !== outer &&
							queries.has(n.callee.name)
						) {
							wrappedBy.set(n.callee.name, outer);
						}
					});
				}

				if (wrappedBy.size === 0) return;

				walk(program, (/** @type {RuleNode} */ n) => {
					if (
						n.type !== 'CallExpression' ||
						n.callee.type !== 'MemberExpression' ||
						n.callee.property.type !== 'Identifier' ||
						n.callee.property.name !== 'refresh'
					) {
						return;
					}
					const target = n.callee.object;
					if (target.type !== 'CallExpression' || target.callee.type !== 'Identifier') return;

					const inner = target.callee.name;
					const outer = wrappedBy.get(inner);
					if (!outer) return;

					context.report({ node: n, messageId: 'composed', data: { inner, outer } });
				});
			}
		};
	}
};
