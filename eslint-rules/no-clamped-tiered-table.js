/** @typedef {import('./ast.js').RuleNode} RuleNode */

/**
 * A table with visibility tiers must not sit in a width-clamped `PageContent`.
 *
 * `col-support` and `col-extra` are container queries on `PageContent`'s
 * `@container` — they hide below 32rem and 48rem of *content* width. A fixed
 * `max-w-*` pins that container at one size for every desktop, so the tiers
 * stop tracking anything: `width="3xl"` is exactly 48rem, which leaves every
 * `col-extra` column rendered in the narrowest container the app allows, and
 * `2xl` is below it, which hides those columns at every width instead. Six
 * inventory lists shipped the first version (#1216).
 *
 * The failure is silent either way — the markup is correct and the classes are
 * spelled right — so it needs a rule rather than a review.
 */

const TIER = /\b(col-support|col-extra)\b/;

/**
 * Detail pages carrying the same defect, where the fix is a per-page call
 * rather than dropping the prop: the clamp is there for the fact grids, and
 * unclamping to fix one inner table would widen the prose past a measure.
 * #1218 decides each; closing it means emptying this list.
 */
const GRANDFATHERED = [
	'member/groups/[slug]',
	'staff/bands/[id]',
	'staff/groups/[id]',
	'staff/volunteer/duty-lists/[id]',
	'staff/inventory/[id]',
	'staff/inventory/acquisitions/[id]',
	'staff/inventory/assets/[id]',
	'staff/marketing/audiences/[id]',
	'staff/events/[id]',
	'staff/events/[id]/production'
].map((r) => `src/routes/${r}/+page.svelte`);

/** @type {import('eslint').Rule.RuleModule} */
export default {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Forbid a width-clamped PageContent on a page whose table uses column visibility tiers.'
		},
		schema: [],
		messages: {
			clamped:
				'`width="{{width}}"` pins this page\'s @container at one size, so `col-support`/`col-extra` never tier. Drop the width prop.'
		}
	},
	create(context) {
		const file = context.filename.replaceAll('\\', '/');
		if (GRANDFATHERED.some((g) => file.endsWith(g))) return {};

		/** @type {{ node: RuleNode, width: string } | null} */
		let clamped = null;
		let hasTier = false;

		return {
			/** @param {RuleNode} node */
			SvelteElement(node) {
				if (node.name?.name !== 'PageContent') return;
				for (const attr of node.startTag?.attributes ?? []) {
					if (attr.type !== 'SvelteAttribute' || attr.key?.name !== 'width') continue;
					const part = Array.isArray(attr.value) ? attr.value[0] : undefined;
					if (part?.type !== 'SvelteLiteral' || part.value === 'full') continue;
					clamped = { node, width: part.value };
				}
			},
			/** @param {RuleNode} node */
			SvelteAttribute(node) {
				if (node.key?.name !== 'class' || !Array.isArray(node.value)) return;
				for (const part of node.value) {
					if (part.type === 'SvelteLiteral' && TIER.test(part.value)) hasTier = true;
				}
			},
			'Program:exit'() {
				if (clamped && hasTier) {
					context.report({
						node: clamped.node,
						messageId: 'clamped',
						data: { width: clamped.width }
					});
				}
			}
		};
	}
};
