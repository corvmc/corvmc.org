/** @typedef {import('./ast.js').RuleNode} RuleNode */

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

/**
 * The shapes this has to see, because every one of them is in this repo:
 *
 *   let a = $derived(await q());  let b = $derived(await r());   // sibling awaits
 *   let a = $derived(q());        let b = $derived(r());         // promises for {#await}
 *   let a = $state(q());          let b = $state(r());
 *   let a = $derived.by(async () => await q());                  // the rune runs the body
 *   {@const a = q()}              {@const b = r()}               // markup
 *   Promise.all([q(), r()])                                      // one declaration, two starts
 *
 * The first version of this rule matched only the last one, and only with literal calls as the
 * array elements. Every real offender used one of the others — including all five `Promise.*`
 * sites, which pass identifiers — so 50 files fanned out while lint stayed green.
 *
 * What separates a fan-out from a waterfall is whether the calls *start* together, so the count
 * is of remote calls reached without going through a function body. A call inside an arrow is
 * deferred work — a `.then` continuation, an event handler, a `loadMore` prop — and runs later
 * by construction:
 *
 *   let d = $derived(getProfile(slug).then(async (p) => ({ ...p, shows: await getShows(p.id) })));
 *
 * is one start, not two, and `(public)/directory/bands/[slug]` is written that way on purpose.
 * The exception is `$derived.by` / `$state.by`, where the function *is* the expression the rune
 * evaluates, so its body counts as immediate.
 */

const BY_RUNES = new Set(['$derived', '$state']);

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
		return {
			Program(program) {
				/** Local names imported from a `*.remote` module. */
				const remoteNames = new Set();

				/** @param {RuleNode} node @param {(n: RuleNode) => void} visit */
				const children = (node, visit) => {
					for (const key of Object.keys(node)) {
						if (key === 'parent') continue;
						const child = node[key];
						if (Array.isArray(child))
							child.forEach(
								(/** @type {RuleNode} */ c) => c && typeof c.type === 'string' && visit(c)
							);
						else if (child && typeof child.type === 'string') visit(child);
					}
				};

				/** @param {RuleNode} node @param {(n: RuleNode) => void} visit */
				const walk = (node, visit) => {
					if (!node || typeof node.type !== 'string') return;
					visit(node);
					children(node, (/** @type {RuleNode} */ c) => walk(c, visit));
				};

				walk(program, (/** @type {RuleNode} */ n) => {
					if (n.type !== 'ImportDeclaration') return;
					if (!/\.remote$/.test(n.source.value ?? '')) return;
					for (const spec of n.specifiers) {
						if (spec.type === 'ImportSpecifier') remoteNames.add(spec.local.name);
					}
				});
				if (remoteNames.size === 0) return;

				/** @param {RuleNode} n */
				const isRemoteCall = (n) =>
					n.type === 'CallExpression' &&
					n.callee.type === 'Identifier' &&
					remoteNames.has(n.callee.name);

				/** `$derived.by(fn)` / `$state.by(fn)` — the rune evaluates `fn` for us. */
				/** @param {RuleNode} callee */
				const isByRune = (callee) =>
					callee.type === 'MemberExpression' &&
					callee.object.type === 'Identifier' &&
					BY_RUNES.has(callee.object.name) &&
					callee.property.type === 'Identifier' &&
					callee.property.name === 'by';

				// Anything with a body that runs when something calls it. `FunctionDeclaration` is
				// easy to leave out and the omission is silent: it made `staff/events/[id]` — the
				// #270 conversion, one query — count 2, because a `const result = await
				// checkRebook(...)` inside a hoisted `function` looked like a top-level start.
				/** @param {RuleNode} n */
				const isFunction = (n) =>
					n.type === 'ArrowFunctionExpression' ||
					n.type === 'FunctionExpression' ||
					n.type === 'FunctionDeclaration' ||
					n.type === 'SvelteSnippetBlock';

				/** Remote calls this expression starts immediately, rather than deferring. */
				/** @param {RuleNode} root */
				function countImmediate(root) {
					let count = 0;
					/** @param {RuleNode} n */
					const visit = (n) => {
						if (isFunction(n)) return;
						if (isRemoteCall(n)) count += 1;

						if (n.type === 'CallExpression' && isByRune(n.callee)) {
							for (const arg of n.arguments) {
								if (isFunction(arg)) children(arg, visit);
								else visit(arg);
							}
							return;
						}

						children(n, visit);
					};
					visit(root);
					return count;
				}

				// Declarations at component top level. A declaration inside a function is that
				// function's business, and runs when it is called.
				/** @type {RuleNode[]} */
				const starters = [];
				/** @param {RuleNode} node */
				const scan = (node) => {
					if (!node || typeof node.type !== 'string') return;
					if (isFunction(node)) return;

					const declarator =
						node.type === 'VariableDeclaration'
							? node
							: node.type === 'SvelteConstTag'
								? node.declaration
								: null;

					if (declarator) {
						const count = countImmediate(declarator);
						if (count > 0) starters.push({ node, count });
						return;
					}

					children(node, scan);
				};
				scan(program);

				const total = starters.reduce((sum, s) => sum + s.count, 0);
				if (total > 1) {
					context.report({
						node: starters[0].node,
						messageId: 'concurrent',
						data: { count: String(total) }
					});
				}
			}
		};
	}
};
