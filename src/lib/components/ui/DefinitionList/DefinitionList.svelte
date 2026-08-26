<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * The label/value grid that every staff detail page uses.
	 *
	 * Pair it with `Fact`, which renders a bare `<dt>`/`<dd>` pair and nothing
	 * else. That is deliberate: `grid-template-columns: auto 1fr` only lines the
	 * two columns up when the `<dt>`s and `<dd>`s are *direct* children of this
	 * `<dl>`, so `Fact` must not introduce a wrapper element. Svelte components
	 * add no DOM of their own, which is what makes the split work.
	 *
	 * ```svelte
	 * <DefinitionList>
	 *   <Fact label="Status"><StatusBadge status={x.status} /></Fact>
	 *   <Fact label="ID" mono>{x.id}</Fact>
	 *   {#if x.notes}<Fact label="Notes" wrap>{x.notes}</Fact>{/if}
	 * </DefinitionList>
	 * ```
	 */
	let {
		class: extraClass = '',
		children
	}: {
		class?: string;
		children: Snippet;
	} = $props();
</script>

<dl class="grid gap-x-4 gap-y-2 text-sm {extraClass}" style="grid-template-columns: auto 1fr;">
	{@render children()}
</dl>
