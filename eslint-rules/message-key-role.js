/** @typedef {import('./ast.js').RuleNode} RuleNode */

/**
 * A message key ends with the role its string plays (#2513), so the catalog
 * check can hold each string to the rubric for that role (writing.md).
 *
 * Flags an `m.<key>` passed straight to a copy prop, property, prop default or
 * `toast.*()` whose key does not end in that role's suffix. The table is also
 * what `scripts/message-key-roles.ts` renames by, so the two cannot disagree.
 */

export const ROLES = /** @type {const} */ ([
	'title',
	'label',
	'checkbox',
	'body',
	'toast',
	'placeholder',
	'error',
	'text'
]);

/** @type {Record<string, (typeof ROLES)[number]>} */
const EXACT = {
	title: 'title',
	heading: 'title',
	legend: 'title',
	emptyLabel: 'title',
	label: 'label',
	'aria-label': 'label',
	'data-tip': 'label',
	tooltip: 'label',
	checkboxLabel: 'checkbox',
	description: 'body',
	desc: 'body',
	subtitle: 'body',
	sub: 'body',
	empty: 'body',
	note: 'body',
	tip: 'body',
	hint: 'body',
	help: 'body',
	caption: 'body',
	message: 'body',
	confirm: 'body',
	placeholder: 'placeholder',
	error: 'error'
};

/** @type {[RegExp, (typeof ROLES)[number]][]} */
const SUFFIX = [
	[/Title$/, 'title'],
	[/Label$/, 'label'],
	[/Toast$/, 'toast'],
	[/Placeholder$/, 'placeholder'],
	[/(Description|Subtitle|Hint|Note)$/, 'body'],
	[/Error$/, 'error']
];

/** The role a prop, attribute or property of this name gives its string. @param {string} name */
export function propRole(name) {
	if (Object.hasOwn(EXACT, name)) return EXACT[name];
	return SUFFIX.find(([re]) => re.test(name))?.[1] ?? null;
}

/**
 * A native element's `title` is a tooltip naming it, not a heading.
 * @param {string} name @param {RuleNode | undefined} element
 */
export function attributeRole(name, element) {
	if (name === 'title' && element?.kind === 'html') return 'label';
	return propRole(name);
}

/** @param {string} key */
export const keyRole = (key) => ROLES.find((role) => key.endsWith(`_${role}`)) ?? null;

const PASS_THROUGH = new Set([
	'ChainExpression',
	'LogicalExpression',
	'TemplateLiteral',
	'BinaryExpression',
	'TSAsExpression',
	'TSNonNullExpression',
	'TSSatisfiesExpression'
]);

/**
 * The node a value is handed to once wrappers that keep its role are climbed:
 * either branch of a choice, a join, `(a ? m.x : m.y)(inputs)`.
 * @param {RuleNode} node
 */
export function climb(node) {
	let value = node;
	let parent = value.parent;
	while (
		parent &&
		(PASS_THROUGH.has(parent.type) ||
			(parent.type === 'ConditionalExpression' && parent.test !== value) ||
			(parent.type === 'CallExpression' && parent.callee === value))
	) {
		value = parent;
		parent = parent.parent;
	}
	return { value, parent };
}

/**
 * The role a prop-shaped context gives `value`, or null if it is not one. An
 * object that is a message's inputs makes a fragment of a sentence: `text`.
 * @param {RuleNode} value @param {RuleNode} parent @param {(n: RuleNode) => boolean} isMessage
 */
export function propContextRole(value, parent, isMessage) {
	if (parent.type === 'SvelteMustacheTag' && parent.parent?.type === 'SvelteAttribute') {
		const attribute = parent.parent;
		const element = attribute.parent?.parent;
		if (element?.name?.name === 'ParaglideMessage') return null;
		return attributeRole(attribute.key?.name ?? '', element);
	}
	if (parent.type === 'Property' && parent.value === value) {
		const call = parent.parent?.parent;
		if (call?.type === 'CallExpression' && isMessage(call.callee)) return 'text';
		return propRole(parent.key?.name ?? parent.key?.value ?? '');
	}
	if (parent.type === 'AssignmentPattern' && parent.right === value) {
		const owner = parent.parent?.type === 'Property' ? parent.parent.key : parent.left;
		return propRole(owner?.name ?? '');
	}
	const callee = parent.type === 'CallExpression' ? parent.callee : null;
	if (callee?.type === 'MemberExpression' && callee.object?.name === 'toast') return 'toast';
	return null;
}

/**
 * @param {import('eslint').Rule.RuleContext} context @param {RuleNode} node @param {string} name
 */
function resolvesToImport(context, node, name) {
	/** @type {import('eslint').Scope.Scope | null} */
	let scope = context.sourceCode.getScope(node);
	for (; scope; scope = scope.upper) {
		const variable = scope.set.get(name);
		if (variable) return variable.defs.some((/** @type {any} */ d) => d.type === 'ImportBinding');
	}
	return false;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
	meta: {
		type: 'problem',
		docs: { description: 'A message key ends with the role of the prop it is passed to.' },
		schema: [],
		messages: {
			role: '`{{key}}` is passed as a {{role}} ({{via}}), so its key ends in `_{{role}}`. Run `pnpm messages:roles`.'
		}
	},
	create(context) {
		/** @type {Set<string>} */
		const names = new Set();
		/** @param {RuleNode} node */
		const isMessage = (node) =>
			node?.type === 'MemberExpression' &&
			!node.computed &&
			names.has(node.object?.name) &&
			resolvesToImport(context, node, node.object.name);

		return {
			/** @param {RuleNode} node */
			ImportDeclaration(node) {
				if (!/paraglide\/messages(\.js)?$/.test(node.source.value)) return;
				for (const s of node.specifiers) if (s.imported?.name === 'm') names.add(s.local.name);
			},
			/** @param {RuleNode} node */
			MemberExpression(node) {
				const key = node.property?.name;
				if (!key || key.startsWith('term_') || !isMessage(node)) return;
				const start = node.parent?.type === 'CallExpression' && node.parent.callee === node;
				const { value, parent } = climb(start ? node.parent : node);
				if (!parent) return;
				const role = propContextRole(value, parent, isMessage);
				if (!role || keyRole(key) === role) return;
				const via =
					parent.parent?.key?.name ??
					parent.key?.name ??
					parent.key?.value ??
					(parent.type === 'CallExpression' ? 'toast' : 'default');
				context.report({ node, messageId: 'role', data: { key, role, via } });
			}
		};
	}
};
