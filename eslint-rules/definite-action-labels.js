/** @typedef {import('./ast.js').RuleNode} RuleNode */

/**
 * An action's label and modal title are definite: a verb and its object, never
 * "someone", "something" or "anyone" (#1829). The form inside says who or what.
 *
 * Reads string literals in `label`, `modalTitle` and `submitLabel` on `Button`,
 * `Action`, `SubmitButton` and every `*Action` component, and the literal
 * defaults a `*Action.svelte` file gives those props. Labels built at runtime
 * are not seen.
 */

const PROPS = new Set(['label', 'modalTitle', 'submitLabel']);
const INDEFINITE = /\b(some(one|thing|body)|any(one|thing|body))\b/i;

/** @param {string | undefined} name */
const isActionComponent = (name) =>
	name === 'Button' || name === 'SubmitButton' || (!!name && /Action$/.test(name));

/** @type {import('eslint').Rule.RuleModule} */
export default {
	meta: {
		type: 'suggestion',
		docs: { description: 'Require action labels and modal titles to be definite.' },
		schema: [],
		messages: {
			indefinite:
				'"{{word}}" makes this {{prop}} indefinite. Name the act and its object ("Log hours", "New suggestion"); the form says who or what.'
		}
	},
	create(context) {
		/** @param {RuleNode} node @param {string} text @param {string} prop */
		function check(node, text, prop) {
			const match = INDEFINITE.exec(text);
			if (match) context.report({ node, messageId: 'indefinite', data: { word: match[0], prop } });
		}

		const inActionFile = /Action\.svelte$/.test(context.filename);

		return {
			/** @param {RuleNode} node */
			SvelteAttribute(node) {
				const prop = node.key?.name;
				if (!PROPS.has(prop)) return;
				const element = node.parent?.parent;
				if (element?.type !== 'SvelteElement' || !isActionComponent(element.name?.name)) return;
				for (const part of node.value ?? []) {
					if (part.type === 'SvelteLiteral') check(part, part.value, prop);
				}
			},
			/** @param {RuleNode} node */
			AssignmentPattern(node) {
				if (!inActionFile) return;
				const prop = node.left?.name;
				if (!PROPS.has(prop) || node.parent?.type !== 'Property') return;
				if (node.right?.type === 'Literal' && typeof node.right.value === 'string') {
					check(node.right, node.right.value, prop);
				}
			}
		};
	}
};
