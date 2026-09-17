/** @typedef {import('./ast.js').RuleNode} RuleNode */

/**
 * An `Alert`'s action goes in its `action` snippet, not in its prose.
 *
 * `Alert` renders `children` in one box and `action` as its sibling, so the
 * two sit side by side. A `<Button>` written inline after the text instead
 * joins the text flow — and `.btn` is `inline-flex` with a fixed `height`
 * taller than the line box, so as soon as the sentence wraps the button
 * overlaps the line beside it. On `/band/[slug]/members` it sat on top of
 * "another active member" (#1232).
 *
 * It is latent at wide viewports where the sentence fits on one line, which is
 * why three of these shipped: they look right until the text is long enough,
 * the window narrow enough, or the band's name one word longer.
 *
 * A `<Button>` nested inside a layout element the page controls — its own
 * flex row — is fine and not reported; the defect is specifically a button
 * loose in flowing text.
 */

/** @type {import('eslint').Rule.RuleModule} */
export default {
	meta: {
		type: 'problem',
		docs: {
			description: "Require an Alert's Button or Action to use the `action` snippet."
		},
		schema: [],
		messages: {
			inline:
				'Put this <{{name}}> in `{#snippet action()}` — loose in the prose it overlaps the text when the sentence wraps.'
		}
	},
	create(context) {
		/** Nearest enclosing Alert, if the element is loose in its children. */
		function looseInAlert(/** @type {RuleNode} */ node) {
			for (let p = node.parent; p; p = p.parent) {
				if (p.type === 'SvelteSnippetBlock') return null;
				// A layout element the page owns — it is arranging the button itself.
				if (p.type === 'SvelteElement' && p.name?.name && /^[a-z]/.test(p.name.name)) return null;
				if (p.type === 'SvelteElement' && p.name?.name === 'Alert') return p;
			}
			return null;
		}

		return {
			/** @param {RuleNode} node */
			SvelteElement(node) {
				const name = node.name?.name;
				if (name !== 'Button' && name !== 'Action') return;
				if (!looseInAlert(node)) return;
				context.report({ node, messageId: 'inline', data: { name } });
			}
		};
	}
};
