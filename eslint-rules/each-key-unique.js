/** @typedef {import('./ast.js').RuleNode} RuleNode */
/** @typedef {import('typescript').Type} Type */
import ts from 'typescript';

/**
 * `{#each list as x (x)}` keys each row by the value itself, and Svelte throws
 * `each_key_duplicate` on a repeat, which stops the block rendering (#3275,
 * #3284). Over free text (`string`) that needs proof of no repeat: the
 * `UniqueTags` type, or a key by index or id. String literal unions and other
 * element types are left alone. Without type information it reports nothing.
 */

/** True when the type is `string` itself, or a union holding it. */
function isWideString(/** @type {Type} */ type) {
	const parts = type.isUnion() ? type.types : [type];
	return parts.some((t) => (t.flags & ts.TypeFlags.String) !== 0);
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
	meta: {
		type: 'problem',
		messages: {
			selfKeyed:
				'A free-text list keyed by its own value breaks on a repeat. Pass it through uniqueTags() (type UniqueTags), or key by index or id.'
		},
		schema: []
	},
	create(context) {
		const services = context.sourceCode.parserServices;
		if (!services?.program || !services.esTreeNodeToTSNodeMap) return {};
		const checker = services.program.getTypeChecker();
		return {
			/** @param {RuleNode} node */
			SvelteEachBlock(node) {
				const { key, context: item, expression } = node;
				if (key?.type !== 'Identifier' || item?.type !== 'Identifier') return;
				if (key.name !== item.name) return;
				const tsNode = services.esTreeNodeToTSNodeMap.get(expression);
				if (!tsNode) return;
				const listType = checker.getTypeAtLocation(tsNode);
				if (listType.aliasSymbol?.getName() === 'UniqueTags') return;
				const element = checker.getTypeAtLocation(services.esTreeNodeToTSNodeMap.get(item));
				if (!isWideString(element)) return;
				context.report({ node: key, messageId: 'selfKeyed' });
			}
		};
	}
};
