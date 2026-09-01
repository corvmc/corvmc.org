/**
 * Keeps route templates composing components rather than re-deriving them from
 * utility classes. Background and numbers: docs/development/template-audit.md.
 *
 * Warn, not error, and only on `+page.svelte` — a component library is allowed
 * to write the classes it exists to encapsulate. Everything flagged here has a
 * component or a semantic utility that already does the job.
 */

/** daisyUI classes that a shared component owns. */
const COMPONENTISED = {
	btn: '<Button variant size> from $lib/components/ui/Button.svelte',
	card: '<Card> from $lib/components/ui/Card/',
	'card-body': '<CardBody> from $lib/components/ui/Card/',
	'card-title': '<CardTitle> from $lib/components/ui/Card/',
	badge: '<Badge variant size> from $lib/components/ui/Badge.svelte',
	alert: '<Alert type> from $lib/components/ui/Alert.svelte',
	stat: '<StatCard> from $lib/components/ui/StatCard.svelte',
	table: '<Table> from $lib/components/ui/Table.svelte'
};

/**
 * Legitimate raw uses. `Button` renders a `<button>` or an `<a>`, so a `btn`
 * skin on anything else has nowhere to go; `card` on a link or a list item is
 * the same story.
 *
 * `Button` appears under `card` because it *is* the `<a>` case: a clickable card
 * routed through the component still renders an anchor, but this rule reads the
 * element name off the AST and cannot see through a component to what it emits.
 * Without this the rule tells three correct call sites to use `<Card>` — which
 * would render a `<div>` and lose the link.
 */
const RAW_OK_FOR = { btn: ['label', 'summary', 'span'], card: ['a', 'li', 'Button'] };

/** daisyUI 4 spellings that emit no CSS in daisyUI 5. */
const DEAD = new Set([
	'input-bordered',
	'select-bordered',
	'textarea-bordered',
	'file-input-bordered'
]);

const OPACITY = new Set(['opacity-50', 'opacity-60', 'opacity-70']);

/**
 * Does this class list give the card a surface `Card` cannot express?
 *
 * `Card`'s `tone` vocabulary is `base-100` / `base-200` / `base-300`. A card
 * washed with a semantic tint (`bg-warning/10 border-warning/40`) or built on
 * the `surface` token has no tone to ask for, so `<Card>` would paint
 * `bg-base-100` over it — two background utilities whose winner is decided by
 * stylesheet order, not by the class attribute.
 *
 * template-audit.md's Phase 3 notes already list "tinted one-offs like
 * `bg-warning/10 border-warning/40`" among the cards deliberately left raw.
 * This is that decision written where the rule can read it, rather than four
 * warnings advising a migration the page cannot make.
 */
const SUPPLIES_OWN_SURFACE = (tokens) =>
	tokens.some((t) => t === 'surface' || /^(bg|border)-[a-z-]+\/\d+$/.test(t));

/**
 * Layout primitives, which do not count toward the token budget.
 *
 * The budget exists to catch a component being built inline — a pile of
 * colour, spacing and border classes that should have a name. Flexbox and grid
 * classes are not that. `flex flex-wrap items-center gap-2` is not a component
 * waiting to happen, it is how you put three things in a row, and there is no
 * component or utility that expresses it more clearly than the classes do.
 * Counting them meant a plain action row scored 6 and got flagged beside a
 * genuine 11-class panel, which made the warning mean two different things.
 *
 * Matches the whole family by substring so responsive and directional variants
 * come along: `flex`, `inline-flex`, `flex-col`, `sm:grid-cols-3`, `gap-x-6`.
 *
 * The alignment classes are here for the same reason, and they have to be named
 * separately because none of them contains the string `flex` or `grid` even
 * though not one of them does anything outside a flex or grid container:
 * `items-*`, `justify-*` (including `justify-items-*` / `justify-self-*`),
 * `self-*` and `place-*`. Leaving them counted meant `flex items-center
 * justify-between` spent three of the five slots saying "in a row".
 */
const LAYOUT = /flex|grid|gap|items-|justify-|self-|place-/;

const MAX_TOKENS = 5;

/** @type {import('eslint').Rule.RuleModule} */
export default {
	meta: {
		type: 'suggestion',
		docs: {
			description:
				'Discourage hand-written utility-class soup in route pages where a shared component or semantic utility already exists.'
		},
		schema: [
			{
				type: 'object',
				properties: { maxTokens: { type: 'integer', minimum: 1 } },
				additionalProperties: false
			}
		],
		messages: {
			tooMany:
				'{{count}} non-layout utility classes on one element — past about {{max}} this is a component, not a class list. Flexbox/grid/gap classes are not counted. See docs/development/ui-patterns.md.',
			componentised: 'Use {{use}} instead of a raw `{{cls}}` class.',
			dead: '`{{cls}}` emits no CSS in daisyUI 5 (the border is the default) — delete it.',
			muted:
				'Use `{{use}}` instead of `{{size}} {{opacity}}`. Colour, not opacity, so nested badges and links keep their own.',
			inlineVar:
				'Reach design tokens through a utility (`text-fg-2`, `text-cmc-navy`, `surface`), not an inline style.'
		}
	},
	create(context) {
		const filename = context.filename ?? context.getFilename();
		if (!filename.endsWith('+page.svelte')) return {};
		const max = context.options?.[0]?.maxTokens ?? MAX_TOKENS;

		/** The literal text of an attribute, or null when it interpolates. */
		function literal(node) {
			if (!Array.isArray(node.value) || node.value.length !== 1) return null;
			const only = node.value[0];
			return only.type === 'SvelteLiteral' ? only.value : null;
		}

		function elementName(node) {
			const el = node.parent?.parent;
			return el?.name?.name ?? null;
		}

		return {
			SvelteAttribute(node) {
				const name = node.key?.name;
				if (name !== 'class' && name !== 'style') return;
				const text = literal(node);
				if (text === null) return;

				if (name === 'style') {
					if (text.includes('var(--')) context.report({ node, messageId: 'inlineVar' });
					return;
				}

				const tokens = text.split(/\s+/).filter(Boolean);
				if (!tokens.length) return;
				const set = new Set(tokens);
				const el = elementName(node);

				for (const cls of tokens) {
					if (DEAD.has(cls)) {
						context.report({ node, messageId: 'dead', data: { cls } });
						continue;
					}
					const use = COMPONENTISED[cls];
					if (!use) continue;
					if (RAW_OK_FOR[cls]?.includes(el)) continue;
					if (cls === 'card' && SUPPLIES_OWN_SURFACE(tokens)) continue;
					context.report({ node, messageId: 'componentised', data: { cls, use } });
				}

				for (const size of ['text-sm', 'text-xs']) {
					if (!set.has(size)) continue;
					const opacity = tokens.find((t) => OPACITY.has(t));
					if (!opacity) continue;
					context.report({
						node,
						messageId: 'muted',
						data: { size, opacity, use: size === 'text-sm' ? 'text-muted' : 'text-subtle' }
					});
				}

				const counted = tokens.filter((t) => !LAYOUT.test(t));
				if (counted.length > max) {
					context.report({
						node,
						messageId: 'tooMany',
						data: { count: String(counted.length), max: String(max) }
					});
				}
			}
		};
	}
};
