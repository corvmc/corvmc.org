/** @typedef {import('./ast.js').RuleNode} RuleNode */

/**
 * One file field: `FileUpload` (directly, or through `FormField type="file"`).
 *
 * It owns the picker, the preview, the in-flight state, the error and the
 * multipart enctype a deferred upload needs. A raw `<input type="file">` (or a
 * spread of `field.as('file')`) re-implements a subset of that, differently.
 */

/** True for a spread whose expression is a `.as('file')` call. */
function isFileSpread(/** @type {RuleNode} */ attr) {
	const call = attr.argument;
	if (call?.type !== 'CallExpression') return false;
	const callee = call.callee;
	if (callee?.type !== 'MemberExpression' || callee.property?.name !== 'as') return false;
	const first = call.arguments?.[0];
	return first?.type === 'Literal' && first.value === 'file';
}

/** True for a literal `type="file"`. */
function isFileType(/** @type {RuleNode} */ attr) {
	if (attr.type !== 'SvelteAttribute' || attr.key?.name !== 'type') return false;
	const parts = Array.isArray(attr.value) ? attr.value : [];
	return parts.length === 1 && parts[0].type === 'SvelteLiteral' && parts[0].value === 'file';
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
	meta: {
		type: 'problem',
		docs: { description: 'Disallow a raw file input outside FileUpload.' },
		schema: [],
		messages: {
			rawFileInput:
				'Use `FileUpload` (or `FormField type="file"`) from $lib/components/ui/Form/ instead of a raw file input.'
		}
	},
	create(context) {
		return {
			/** @param {RuleNode} node */
			SvelteElement(node) {
				if (node.name?.name !== 'input') return;
				const attrs = node.startTag?.attributes ?? [];
				const raw = attrs.some(
					(/** @type {RuleNode} */ a) =>
						isFileType(a) || (a.type === 'SvelteSpreadAttribute' && isFileSpread(a))
				);
				if (raw) context.report({ node, messageId: 'rawFileInput' });
			}
		};
	}
};
