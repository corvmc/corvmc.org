/** @typedef {import('./ast.js').RuleNode} RuleNode */

/**
 * Interface copy is read from the message catalog (#2099), so every string can
 * be reviewed and trimmed in `messages/en.json` rather than across 700 files.
 *
 * Flags, in a `.svelte` file: a template text node with a letter in it, a copy
 * attribute (`label`, `title`, `*Label`, `*Toast`, …), a copy property in an
 * object literal, and the first argument of `toast.*()`.
 */

const COPY_NAME =
	/^(label|title|subtitle|heading|description|desc|placeholder|alt|empty|message|aria-label|aria-description|data-tip)$|(Label|Title|Toast|Message|Text|Description|Heading|Placeholder|Hint)$/;

const LETTER = /\p{L}/u;
const ENTITY = /&[a-z0-9#]+;/gi;

/** Text that is not prose: glyphs, numbers, punctuation, entities. */
function hasCopy(/** @type {unknown} */ text) {
	return typeof text === 'string' && LETTER.test(text.replace(ENTITY, ''));
}

/** @param {RuleNode} element */
function isHidden(element) {
	for (let el = element; el; el = el.parent) {
		if (el.type === 'SvelteStyleElement' || el.type === 'SvelteScriptElement') return true;
		if (el.type !== 'SvelteElement') continue;
		if (el.name?.name === 'code' || el.name?.name === 'kbd') return true;
		const hidden = el.startTag?.attributes?.find(
			(/** @type {RuleNode} */ a) => a.key?.name === 'aria-hidden'
		);
		const value = hidden?.value?.[0];
		if (value?.type === 'SvelteLiteral' && value.value === 'true') return true;
	}
	return false;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
	meta: {
		type: 'suggestion',
		docs: { description: 'Read interface copy from the message catalog, not a literal.' },
		schema: [
			{
				type: 'object',
				properties: { allow: { type: 'array', items: { type: 'string' } } },
				additionalProperties: false
			}
		],
		messages: {
			literal:
				'"{{text}}" is interface copy. Add it to the catalog (messages/en/<area>.json) and read it as m.<key>() from $lib/paraglide/messages.js.'
		}
	},
	create(context) {
		const allow = new Set(context.options[0]?.allow ?? []);

		/** @param {RuleNode} node @param {unknown} value */
		function report(node, value) {
			if (!hasCopy(value)) return;
			const text = String(value).trim().replace(/\s+/g, ' ');
			if (allow.has(text)) return;
			context.report({ node, messageId: 'literal', data: { text: text.slice(0, 60) } });
		}

		/** A literal, a template's static text, or either branch of a choice. @param {RuleNode} node */
		function expression(node) {
			if (!node) return;
			if (node.type === 'Literal') report(node, node.value);
			else if (node.type === 'TemplateLiteral') {
				const text = node.quasis.map((/** @type {RuleNode} */ q) => q.value.cooked).join(' ');
				report(node, text);
			} else if (node.type === 'ConditionalExpression') {
				expression(node.consequent);
				expression(node.alternate);
			} else if (node.type === 'AssignmentPattern') {
				expression(node.right);
			} else if (node.type === 'LogicalExpression') {
				expression(node.left);
				expression(node.right);
			}
		}

		return {
			/** @param {RuleNode} node */
			SvelteText(node) {
				if (!isHidden(node.parent)) report(node, node.value);
			},
			/** @param {RuleNode} node */
			SvelteAttribute(node) {
				if (!COPY_NAME.test(node.key?.name ?? '')) return;
				for (const part of node.value ?? []) {
					if (part.type === 'SvelteLiteral') report(part, part.value);
					else if (part.type === 'SvelteMustacheTag') expression(part.expression);
				}
			},
			/** @param {RuleNode} node */
			Property(node) {
				const name = node.key?.name ?? node.key?.value;
				if (typeof name === 'string' && COPY_NAME.test(name)) expression(node.value);
			},
			/** @param {RuleNode} node */
			CallExpression(node) {
				const callee = node.callee;
				if (callee?.type === 'MemberExpression' && callee.object?.name === 'toast')
					expression(node.arguments[0]);
			}
		};
	}
};
