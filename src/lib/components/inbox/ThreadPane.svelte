<script lang="ts">
	/**
	 * The height-and-scroll scaffold a conversation pane sits in.
	 *
	 * The three surfaces hand-rolled it and disagreed, which is the half of
	 * #1221 that was real — the shell components were already shared, the frame
	 * was not. `stacked` is staff's case: one scrolling column below `sm`.
	 */
	import type { Snippet } from 'svelte';

	let { children, stacked = false }: { children: Snippet; stacked?: boolean } = $props();
</script>

<div
	class={stacked
		? 'flex flex-col gap-4 overflow-y-auto sm:h-full sm:min-h-0 sm:overflow-visible'
		: 'flex h-full min-h-0 flex-col gap-4'}
>
	{@render children()}
</div>
