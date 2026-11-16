<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * The label/value grid that every staff detail page uses.
	 *
	 * Pair it with `Fact`, which renders a bare `<dt>`/`<dd>` pair and nothing
	 * else. That is deliberate: the `auto minmax(0, 1fr)` grid only lines the
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
		layout = 'grid',
		class: extraClass = '',
		children
	}: {
		/**
		 * `strip` puts each label above its value, one fact per column: a folded
		 * card's facts, which have no table header to name them.
		 */
		layout?: 'grid' | 'strip';
		class?: string;
		children: Snippet;
	} = $props();
</script>

{#if layout === 'strip'}
	<!-- Column flow over two rows: each dt lands above its own dd with no wrapper. -->
	<dl
		class="grid auto-cols-[minmax(0,1fr)] grid-flow-col grid-rows-[auto_auto] gap-x-4 gap-y-0.5 text-sm {extraClass}"
	>
		{@render children()}
	</dl>
{:else}
	<dl
		class="grid gap-x-4 gap-y-2 text-sm {extraClass}"
		style="grid-template-columns: auto minmax(0, 1fr);"
	>
		{@render children()}
	</dl>
{/if}
