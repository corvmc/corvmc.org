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
	btn: '<Button variant size> from $lib/components/shared/Button.svelte',
	card: '<Card> from $lib/components/shared/Card/',
	'card-body': '<CardBody> from $lib/components/shared/Card/',
	'card-title': '<CardTitle> from $lib/components/shared/Card/',
	badge: '<Badge variant size> from $lib/components/shared/Badge.svelte',
	alert: '<Alert type> from $lib/components/shared/Alert.svelte',
	stat: '<StatCard> from $lib/components/shared/StatCard.svelte',
	table: '<Table> from $lib/components/shared/Table.svelte'
};

/**
 * Legitimate raw uses. `Button` renders a `<button>` or an `<a>`, so a `btn`
 * skin on anything else has nowhere to go; `card` on a link or a list item is
 * the same story.
 */
const RAW_OK_FOR = { btn: ['label', 'summary', 'span'], card: ['a', 'li'] };

/** daisyUI 4 spellings that emit no CSS in daisyUI 5. */
const DEAD = new Set([
	'input-bordered',
	'select-bordered',
	'textarea-bordered',
	'file-input-bordered'
]);

const OPACITY = new Set(['opacity-50', 'opacity-60', 'opacity-70']);

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
				'{{count}} utility classes on one element — past about {{max}} this is a component, not a class list. See docs/development/ui-patterns.md.',
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

				if (tokens.length > max) {
					context.report({
						node,
						messageId: 'tooMany',
						data: { count: String(tokens.length), max: String(max) }
					});
				}
			}
		};
	}
};
