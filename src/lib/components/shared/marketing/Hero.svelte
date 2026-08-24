<script lang="ts">
	import type { Snippet } from 'svelte';
	import Section from './Section.svelte';

	/**
	 * The masthead every public page opens with: sunburst backdrop, secondary
	 * wash, an `<h1>` in navy, and one line of subtitle under it.
	 *
	 * The markup was byte-identical on five pages, down to the inline
	 * `style="color: var(--cmc-navy)"`.
	 */
	let {
		title,
		children
	}: {
		title: string;
		/** The subtitle line. */
		children?: Snippet;
	} = $props();
</script>

<Section tint="secondary" pad="lg" width="2xl" center sunburst>
	<div class="flex flex-col items-center gap-4">
		<h1 class="text-5xl font-bold leading-tight tracking-tight text-balance text-cmc-navy">
			{title}
		</h1>
		{#if children}
			<p class="text-lg leading-relaxed text-fg-2">{@render children()}</p>
		{/if}
	</div>
</Section>
