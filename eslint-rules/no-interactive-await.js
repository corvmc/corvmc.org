/** @typedef {import('./ast.js').RuleNode} RuleNode */

/**
 * No form, input, dialog or `*Action` inside an `{#await}` block.
 *
 * `{#await p}` re-pends whenever `p` is a new promise, destroying its `then`
 * subtree and building it again when the promise settles. A remote query hands
 * out a new promise on every `refresh()` and `invalidateAll()` — `NotificationBell`
 * calls the latter on each notification — so an open dialog in that subtree
 * unmounts and whatever was typed into it is lost (#2350, #2352). Read-only
 * markup losing its DOM for a round trip is harmless; interactive markup is not.
 *
 * Render from `new Latest(() => p).current` (`$lib/latest.svelte`) instead,
 * which keeps the last value while the next is in flight, as `DataList` does.
 *
 * It sees elements written in the block, not inside child components, so it is
 * a floor: a component that renders a form is caught only if its name ends in
 * one of the suffixes below.
 */

const INTERACTIVE_TAG = new Set(['input', 'textarea', 'select', 'form', 'dialog']);
const INTERACTIVE_COMPONENT = /(Action|Modal|Form|Field|Input|Select|Textarea|Composer)$/;

/** @type {import('eslint').Rule.RuleModule} */
export default {
	meta: {
		type: 'problem',
		docs: {
			description: 'Disallow interactive markup inside an `{#await}` block.'
		},
		schema: [],
		messages: {
			interactive:
				'<{{name}}> inside `{#await}` is destroyed and rebuilt on every refresh, losing open dialogs and typed input (#2352). Render from `new Latest(() => promise).current` instead.'
		}
	},
	create(context) {
		const reported = new Set();

		/** @param {RuleNode} node */
		function enclosingAwait(node) {
			for (let p = node.parent; p; p = p.parent) {
				if (p.type === 'SvelteAwaitBlock') return p;
			}
			return null;
		}

		return {
			/** @param {RuleNode} node */
			SvelteElement(node) {
				const name = node.name?.name;
				if (typeof name !== 'string') return;
				const interactive = /^[a-z]/.test(name)
					? INTERACTIVE_TAG.has(name)
					: INTERACTIVE_COMPONENT.test(name);
				if (!interactive) return;
				const block = enclosingAwait(node);
				if (!block || reported.has(block)) return;
				reported.add(block);
				context.report({ node: block, messageId: 'interactive', data: { name } });
			}
		};
	}
};
