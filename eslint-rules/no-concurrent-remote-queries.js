/**
 * A page gets one load-bearing server query. Everything else loads lazily.
 *
 * Fanning several queries out of a component at once is a design smell before
 * it is anything else: it makes the page's first paint wait on the slowest of
 * N requests, and it spreads one screen's data contract across N round trips
 * that nothing coordinates. Either the data belongs to the page — in which case
 * one remote query should assemble it on the server, where the calls are a
 * local database hop — or it does not, in which case it belongs behind its own
 * boundary in the component that needs it, loading after the page has painted.
 *
 * It is also load-bearing for correctness. Past @sveltejs/kit 2.64 (bisected to
 * kit#15991, "dedupe remote data") a component that puts more than one remote
 * query in flight at once drives Svelte into `effect_update_depth_exceeded` and
 * renders the error boundary instead of the page. The concurrency is what does
 * it, not the syntax: awaiting a `Promise.all`, reading two queries' `.loading`
 * from one derived, and starting two from separate effects all reproduce it.
 * Serial reads survive, but those are a request waterfall — which is why the
 * answer is one query, not four awaited one after another.
 *
 * When you introduce a load-bearing query, repoint every `.refresh()` of the
 * queries it now wraps. Most of them are not in the component you are editing —
 * they are single-flight refreshes inside the `.remote.ts` mutations, and a
 * missed one leaves the page showing stale data after a save rather than
 * failing, so nothing necessarily catches it. `grep -rn 'getThing(.*).refresh()'`
 * over `src/` before you call the conversion done.
 */

const COMBINATORS = new Set(['all', 'allSettled', 'race', 'any']);

/** @type {import('eslint').Rule.RuleModule} */
export default {
	meta: {
		type: 'problem',
		docs: {
			description:
				'A page gets one load-bearing server query; everything else loads lazily. Disallows fanning several remote queries out of a component at once.'
		},
		messages: {
			concurrent:
				'{{count}} remote queries are fanned out at once here. A page gets one load-bearing query: either assemble these in a single remote query on the server, or move the ones the first paint does not need behind their own boundary and let them load lazily. (Past kit 2.64 this shape also renders the page as `effect_update_depth_exceeded`.)'
		}
	},
	create(context) {
		/** Local names imported from a `*.remote` module. */
		const remoteNames = new Set();

		return {
			ImportDeclaration(node) {
				if (!/\.remote$/.test(node.source.value ?? '')) return;
				for (const spec of node.specifiers) {
					if (spec.type === 'ImportSpecifier') remoteNames.add(spec.local.name);
				}
			},

			CallExpression(node) {
				const callee = node.callee;
				if (
					callee.type !== 'MemberExpression' ||
					callee.object.type !== 'Identifier' ||
					callee.object.name !== 'Promise' ||
					callee.property.type !== 'Identifier' ||
					!COMBINATORS.has(callee.property.name)
				) {
					return;
				}

				const arg = node.arguments[0];
				if (!arg || arg.type !== 'ArrayExpression') return;

				const count = arg.elements.filter(
					(el) =>
						el &&
						el.type === 'CallExpression' &&
						el.callee.type === 'Identifier' &&
						remoteNames.has(el.callee.name)
				).length;

				if (count > 1) {
					context.report({ node, messageId: 'concurrent', data: { count: String(count) } });
				}
			}
		};
	}
};
