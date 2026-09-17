/** @typedef {import('./ast.js').RuleNode} RuleNode */

/**
 * A table row's action has to survive the layout.
 *
 * Two ways it does not. A `<td>` carrying `col-support` or `col-extra` is a
 * visibility tier, so the action inside it disappears below 32rem or 48rem of
 * container — on `/staff/payments` the tiered cell held the row's only link.
 * And a `<div class="flex">` of buttons in a cell has no intrinsic width under
 * `table-layout: auto`, so the column collapses and the last button is clipped
 * rather than truncated: `View reservatio` (#1224, #1229). `w-max` stops it.
 */

const TIER = /\b(col-support|col-extra)\b/;
const ACTION = /^(Button|Action)$|Actions?$/;

/** The literal `class` on a start tag, or `''`. */
function classOf(/** @type {RuleNode} */ node) {
	for (const attr of node.startTag?.attributes ?? []) {
		if (attr.type !== 'SvelteAttribute' || attr.key?.name !== 'class') continue;
		return (Array.isArray(attr.value) ? attr.value : [])
			.filter((/** @type {RuleNode} */ p) => p.type === 'SvelteLiteral')
			.map((/** @type {RuleNode} */ p) => p.value)
			.join(' ');
	}
	return '';
}

/**
 * Every `SvelteElement` under `node`, itself excluded.
 *
 * @param {RuleNode} node
 * @returns {Generator<RuleNode>} annotated because the recursion below makes
 * the inferred return type circular, which `checkJs` reports as an error.
 */
function* descendants(node) {
	for (const child of node.children ?? []) {
		if (child.type === 'SvelteElement') yield child;
		yield* descendants(child);
	}
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
	meta: {
		type: 'problem',
		docs: { description: "Keep a table row's action visible and unclipped." },
		schema: [],
		messages: {
			tiered:
				'`{{tier}}` hides this cell below its breakpoint, and a row action is not diagnostic. Give the action its own `<td class="w-px">`.',
			collapsed:
				'A flex row of actions in a `<td>` has no intrinsic width, so the column collapses and the last button is clipped. Add `w-max`.'
		}
	},
	create(context) {
		return {
			/** @param {RuleNode} node */
			SvelteElement(node) {
				if (node.name?.name !== 'td') return;
				const actions = [...descendants(node)].filter((d) => ACTION.test(d.name?.name ?? ''));
				if (actions.length === 0) return;

				const tier = TIER.exec(classOf(node));
				if (tier) {
					context.report({ node, messageId: 'tiered', data: { tier: tier[0] } });
				}
				for (const d of descendants(node)) {
					if (d.name?.name !== 'div') continue;
					const cls = classOf(d);
					if (!/\bflex\b/.test(cls) || /\bw-max\b/.test(cls)) continue;
					if (![...descendants(d)].some((c) => ACTION.test(c.name?.name ?? ''))) continue;
					context.report({ node: d, messageId: 'collapsed' });
				}
			}
		};
	}
};
