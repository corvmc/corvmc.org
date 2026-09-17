/** @typedef {import('./ast.js').RuleNode} RuleNode */

/**
 * A page's header and its content must be clamped to the same column.
 *
 * `PageHeader` is full-bleed and sticky — it spans the frame so its border and
 * background do. `PageContent width="2xl"` clamps only the body, so a header
 * that does not repeat the width puts the `h1` 232px left of the thing it
 * titles, and the header actions hard against the far edge (#1231).
 *
 * Nothing about the markup looks wrong on either side; the defect only exists
 * in the relationship between the two, which is why 65 pages shipped with it.
 */

/** The literal value of `width` on a start tag, or `undefined` if absent/dynamic. */
function widthOf(/** @type {RuleNode} */ node) {
	for (const attr of node.startTag?.attributes ?? []) {
		if (attr.type !== 'SvelteAttribute' || attr.key?.name !== 'width') continue;
		const part = Array.isArray(attr.value) ? attr.value[0] : undefined;
		return part?.type === 'SvelteLiteral' ? part.value : null;
	}
	return undefined;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
	meta: {
		type: 'problem',
		docs: {
			description: "Require a page's PageHeader and PageContent to declare the same width."
		},
		schema: [],
		messages: {
			mismatch:
				'This page clamps its content to `{{content}}` but its header to `{{header}}`, so the title does not sit above the content. Give PageHeader `width="{{content}}"`.'
		}
	},
	create(context) {
		/** @type {RuleNode | null} */
		let header = null;
		/** @type {string | null | undefined} */
		let headerWidth;
		/** @type {string | null | undefined} */
		let contentWidth;
		let sawContent = false;

		return {
			/** @param {RuleNode} node */
			SvelteElement(node) {
				const name = node.name?.name;
				if (name === 'PageHeader' && !header) {
					header = node;
					headerWidth = widthOf(node);
				} else if (name === 'PageContent' && !sawContent) {
					sawContent = true;
					contentWidth = widthOf(node);
				}
			},
			'Program:exit'() {
				if (!header || !sawContent) return;
				// A dynamic width on either side is the page's own business.
				if (headerWidth === null || contentWidth === null) return;
				const content = contentWidth ?? 'full';
				const declared = headerWidth ?? 'full';
				if (content === declared) return;
				context.report({
					node: header,
					messageId: 'mismatch',
					data: { content, header: declared }
				});
			}
		};
	}
};
