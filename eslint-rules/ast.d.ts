/**
 * The node type a rule in this folder actually receives.
 *
 * These rules run over **two** ASTs. `.ts` files are parsed by
 * `typescript-eslint` into ESTree; `.svelte` files by `svelte-eslint-parser`
 * into a tree with its own node kinds (`SvelteElement`, `SvelteAttribute`, …).
 * ESLint types `Rule.RuleModule`'s visitor map against ESTree alone, so a
 * `SvelteElement(node)` visitor is not in the type at all — and annotating one
 * with `svelte-eslint-parser`'s own `AST.SvelteElement` then fails on
 * `node.name.name`, because that union includes `SvelteMemberExpressionName`,
 * which the rule has already established it is not.
 *
 * Typing this honestly needs a union ESLint does not expose. `any` is the true
 * answer today; declaring it here rather than leaving each parameter implicit
 * keeps `checkJs` on for the rest of the file — which is where the real bugs
 * were, `context.getFilename()` having been removed in ESLint 10 among them —
 * and gives one place to narrow when the parser's types become usable.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RuleNode = any;
