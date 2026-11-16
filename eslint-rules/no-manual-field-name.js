/** @typedef {import('./ast.js').RuleNode} RuleNode */

/**
 * A control inside a remote form takes its name from `field.as(...)`.
 *
 * Kit 3 rejects a remote submission carrying a name it did not hand out, at
 * runtime and with no type error (#2196). A `<Form action>` is a plain handler
 * and keeps `name`. Controls outside any form in the file are only reported
 * with `outsideForm`, since the form they end up in is in another file.
 */

const CONTROL_COMPONENTS = new Set([
	'FormField',
	'Select',
	'MoneyField',
	'CheckboxGroup',
	'SearchSelect',
	'TagSelect',
	'CalendarSelect',
	'FileUpload',
	'RichTextEditor',
	'VisibilityField'
]);
const CONTROL_ELEMENTS = new Set(['input', 'select', 'textarea', 'button']);
/** `ui/Form/index.ts` re-exports FormField as `Field`. */
const ALIASES = new Map([
	['Field', 'FormField'],
	['Form.Field', 'FormField']
]);

/** A tag's name, with `<Form.Field>` spelled out and aliases resolved. */
function tagName(/** @type {RuleNode} */ node) {
	const n = node.name;
	const raw =
		n?.type === 'SvelteMemberExpressionName' ? `${n.object?.name}.${n.property?.name}` : n?.name;
	return ALIASES.get(raw) ?? raw;
}

/** @param {RuleNode} node @param {string} key */
function attr(node, key) {
	return (node.startTag?.attributes ?? []).find(
		(/** @type {RuleNode} */ a) =>
			(a.type === 'SvelteAttribute' || a.type === 'SvelteShorthandAttribute') && a.key?.name === key
	);
}

/** A literal `readonly` / `readonly={true}` FormField renders no control. */
function isStaticallyReadonly(/** @type {RuleNode} */ node) {
	const a = attr(node, 'readonly');
	if (!a || a.type === 'SvelteShorthandAttribute') return false;
	const parts = Array.isArray(a.value) ? a.value : [];
	if (parts.length === 0) return true;
	const expr = parts[0]?.expression;
	return parts.length === 1 && expr?.type === 'Literal' && expr.value === true;
}

/** Whether a form-ish element posts to a remote `form()`, a plain handler, or neither. */
function formKind(/** @type {RuleNode} */ node) {
	const tag = tagName(node);
	if (tag === 'Form') return attr(node, 'remote') ? 'remote' : 'plain';
	// `Action` renders its `form` snippet inside `<Form remote>`; a callback
	// action has no form to render it in.
	if (tag === 'Action') {
		const a = attr(node, 'action');
		const expr = a?.type === 'SvelteShorthandAttribute' ? a.value : a?.value?.[0]?.expression;
		if (!expr) return null;
		const fn = expr.type === 'ArrowFunctionExpression' || expr.type === 'FunctionExpression';
		return fn ? 'plain' : 'remote';
	}
	if (tag !== 'form') return null;
	const attrs = node.startTag?.attributes ?? [];
	const spread = attrs.some((/** @type {RuleNode} */ a) => a.type === 'SvelteSpreadAttribute');
	if (!spread) return 'plain';
	return attr(node, 'method') ? 'plain' : 'remote';
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
	meta: {
		type: 'problem',
		docs: { description: 'Disallow a hand-written name on a control in a remote form.' },
		schema: [
			{
				type: 'object',
				properties: { outsideForm: { type: 'boolean' } },
				additionalProperties: false
			}
		],
		messages: {
			manualName:
				"A control in a remote form takes its name from the field: pass `field={fields.x}`, or spread `fields.x.as('hidden', value)`. Kit 3 rejects a hand-written `name`.",
			outsideForm:
				'A name-only control outside any form in this file. If it renders inside a remote form, give it a `field`.'
		}
	},
	create(context) {
		const outsideForm = context.options[0]?.outsideForm === true;
		/** @type {string[]} */
		const stack = [];

		return {
			/** @param {RuleNode} node */
			SvelteElement(node) {
				const kind = formKind(node);
				if (kind) {
					stack.push(kind);
					return;
				}
				const tag = tagName(node);
				const isControl =
					node.kind === 'component' ? CONTROL_COMPONENTS.has(tag) : CONTROL_ELEMENTS.has(tag);
				if (!isControl) return;
				const name = attr(node, 'name');
				if (!name) return;
				if (node.kind === 'component' && attr(node, 'field')) return;
				if (tag === 'FormField' && isStaticallyReadonly(node)) return;

				const scope = stack[stack.length - 1];
				if (scope === 'remote') context.report({ node: name, messageId: 'manualName' });
				else if (!scope && outsideForm) context.report({ node: name, messageId: 'outsideForm' });
			},
			/** @param {RuleNode} node */
			'SvelteElement:exit'(node) {
				if (formKind(node)) stack.pop();
			}
		};
	}
};
