/** @typedef {import('./ast.js').RuleNode} RuleNode */
/**
 * Get-or-create by select-then-insert races: two callers both read nothing,
 * then both insert, giving a duplicate row or a UNIQUE error (#2681). The
 * insert has to say what a conflict does, against a unique index on the key.
 *
 * Seen within one function: a `.from(t)…limit()` read bound to a variable, an
 * `if` on that variable that returns (or the insert inside such an `if`), then
 * `.insert(t)` with no `onConflictDo*`. Not seen: a read in a helper, a
 * renamed table binding, an unlimited read, or a read that throws on a hit.
 */

const CONFLICT = new Set(['onConflictDoNothing', 'onConflictDoUpdate']);
const FUNCTION = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

/**
 * The method names chained after `node`, outward: from the `insert` call in
 * `db.insert(t).values(v).returning()` that is `values`, `returning`.
 * @param {RuleNode} node
 */
function chainAfter(node) {
	const names = [];
	let current = node;
	while (
		current.parent?.type === 'MemberExpression' &&
		current.parent.object === current &&
		current.parent.property.type === 'Identifier' &&
		current.parent.parent?.type === 'CallExpression'
	) {
		names.push(current.parent.property.name);
		current = current.parent.parent;
	}
	return names;
}

/**
 * @param {RuleNode} node
 * @param {string} method
 * @returns {string | null} the table identifier of a `.method(table)` call
 */
function tableOf(node, method) {
	if (
		node.callee.type !== 'MemberExpression' ||
		node.callee.property.type !== 'Identifier' ||
		node.callee.property.name !== method ||
		node.arguments.length !== 1 ||
		node.arguments[0].type !== 'Identifier'
	) {
		return null;
	}
	return node.arguments[0].name;
}

/** @param {RuleNode} node */
function enclosingFunction(node) {
	let current = node.parent;
	while (current && !FUNCTION.has(current.type)) current = current.parent;
	return current;
}

/**
 * Identifiers a read's result lands in: `const [x] = await …`, `[x] = await …`,
 * or the names of a `Promise.all` destructure it sits inside.
 * @param {RuleNode} node
 * @returns {Set<string>}
 */
function bindingsOf(node) {
	const names = new Set();
	/** @param {RuleNode} pattern */
	const collect = (pattern) => {
		if (!pattern) return;
		if (pattern.type === 'Identifier') names.add(pattern.name);
		else if (pattern.type === 'ArrayPattern') pattern.elements.forEach(collect);
		else if (pattern.type === 'ObjectPattern')
			pattern.properties.forEach((/** @type {RuleNode} */ p) => collect(p.value ?? p.argument));
	};
	let current = node.parent;
	while (current && !FUNCTION.has(current.type)) {
		if (current.type === 'VariableDeclarator') return (collect(current.id), names);
		if (current.type === 'AssignmentExpression') return (collect(current.left), names);
		if (current.type === 'ExpressionStatement' || current.type === 'BlockStatement') break;
		current = current.parent;
	}
	return names;
}

/**
 * @param {RuleNode} node
 * @param {Set<string>} names
 * @returns {boolean}
 */
function mentions(node, names) {
	if (!node || typeof node !== 'object') return false;
	if (node.type === 'Identifier') return names.has(node.name);
	for (const key of Object.keys(node)) {
		if (key === 'parent') continue;
		const value = node[key];
		if (Array.isArray(value) ? value.some((v) => mentions(v, names)) : mentions(value, names))
			return true;
	}
	return false;
}

/**
 * Whether `node` contains a statement of `type`, not counting nested functions.
 * @param {RuleNode} node
 * @param {string} type
 * @returns {boolean}
 */
function contains(node, type) {
	if (!node || typeof node !== 'object') return false;
	if (node.type === type) return true;
	if (FUNCTION.has(node.type)) return false;
	for (const key of Object.keys(node)) {
		if (key === 'parent') continue;
		const value = node[key];
		if (Array.isArray(value) ? value.some((v) => contains(v, type)) : contains(value, type))
			return true;
	}
	return false;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
	meta: {
		type: 'problem',
		docs: {
			description:
				'A get-or-create by select-then-insert races; insert with onConflictDo* against a unique index.'
		},
		messages: {
			race:
				'`{{table}}` is read, and inserted into when the read finds nothing, without conflict ' +
				'handling, so two concurrent callers both insert. Back the key with a unique index and ' +
				'use `.onConflictDoNothing()` (then re-read) or `.onConflictDoUpdate()`.'
		},
		schema: []
	},
	create(context) {
		/** @type {Map<RuleNode, { reads: { table: string, end: number, names: Set<string> }[], inserts: RuleNode[], ifs: RuleNode[] }>} */
		const byFunction = new Map();
		/** @param {RuleNode} fn */
		const entry = (fn) => {
			let e = byFunction.get(fn);
			if (!e) byFunction.set(fn, (e = { reads: [], inserts: [], ifs: [] }));
			return e;
		};

		/**
		 * The `if` that makes this insert the create half of a get-or-create.
		 * @param {RuleNode} insert
		 * @param {{ end: number, names: Set<string> }} read
		 * @param {RuleNode[]} ifs
		 */
		const gate = (insert, read, ifs) =>
			ifs.find(
				(s) =>
					s.range[0] > read.end &&
					mentions(s.test, read.names) &&
					// The insert inside it: `if (!found) insert` or `if (found) … else insert`.
					((s.range[0] < insert.range[0] && insert.range[1] <= s.range[1]) ||
						// Or before it, returning on a hit: `if (found) return found;`.
						(s.range[1] < insert.range[0] &&
							contains(s.consequent, 'ReturnStatement') &&
							!contains(s.consequent, 'ThrowStatement')))
			);

		return {
			IfStatement(/** @type {RuleNode} */ node) {
				const fn = enclosingFunction(node);
				if (fn) entry(fn).ifs.push(node);
			},
			CallExpression(/** @type {RuleNode} */ node) {
				const fn = enclosingFunction(node);
				if (!fn) return;

				const read = tableOf(node, 'from');
				if (read && chainAfter(node).includes('limit')) {
					const names = bindingsOf(node);
					if (names.size > 0) entry(fn).reads.push({ table: read, end: node.range[1], names });
				}

				if (tableOf(node, 'insert') && !chainAfter(node).some((n) => CONFLICT.has(n))) {
					entry(fn).inserts.push(node);
				}
			},
			'Program:exit'() {
				for (const { reads, inserts, ifs } of byFunction.values()) {
					for (const insert of inserts) {
						const table = insert.arguments[0].name;
						const raced = reads.some(
							(read) =>
								read.table === table && read.end < insert.range[0] && gate(insert, read, ifs)
						);
						if (raced) context.report({ node: insert, messageId: 'race', data: { table } });
					}
				}
			}
		};
	}
};
