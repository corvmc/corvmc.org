/** @typedef {import('./ast.js').RuleNode} RuleNode */

/**
 * daisyUI 4 spellings that emit no CSS at all in daisyUI 5.
 *
 * Split out of `no-utility-soup`, which warns and only reads `+page.svelte`.
 * Neither fits: a dead class is a defect rather than a style preference, and
 * `form-control` was written in twenty components where that rule never looked.
 * See docs/development/template-audit.md for the numbers.
 */
const DEAD = {
	'input-bordered': 'the border is the default — delete it',
	'select-bordered': 'the border is the default — delete it',
	'textarea-bordered': 'the border is the default — delete it',
	'file-input-bordered': 'the border is the default — delete it',
	'form-control': 'use `fieldset`, which is what daisyUI 5 calls a stacked field',
	'label-text': 'use `fieldset-legend` for a caption',
	'label-text-alt': 'use `text-muted text-sm` for a hint under a control'
};

/** @type {import('eslint').Rule.RuleModule} */
export default {
	meta: {
		type: 'problem',
		docs: {
			description: 'Forbid daisyUI 4 class names that generate no CSS in daisyUI 5.'
		},
		schema: [],
		messages: {
			dead: '`{{cls}}` emits no CSS in daisyUI 5 — {{fix}}.'
		}
	},
	create(context) {
		return {
			/** @param {RuleNode} node */
			SvelteAttribute(node) {
				if (node.key?.name !== 'class') return;
				if (!Array.isArray(node.value)) return;

				for (const part of node.value) {
					// An interpolated segment is not a literal class name; the rest of
					// the attribute around it still is.
					if (part.type !== 'SvelteLiteral') continue;
					for (const cls of part.value.split(/\s+/).filter(Boolean)) {
						const fix = /** @type {Record<string, string | undefined>} */ (DEAD)[cls];
						if (fix) context.report({ node, messageId: 'dead', data: { cls, fix } });
					}
				}
			}
		};
	}
};
