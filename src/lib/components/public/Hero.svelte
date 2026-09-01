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
		tone = 'navy',
		children,
		actions
	}: {
		title: string;
		/** Headline ink. The landing page opens in teal; inner pages in navy. */
		tone?: 'navy' | 'teal';
		/** The subtitle line. */
		children?: Snippet;
		/** Calls to action under the subtitle — the landing page's two buttons. */
		actions?: Snippet;
	} = $props();
</script>

<Section tint="secondary" pad="lg" width="2xl" center sunburst>
	<div class="flex flex-col items-center gap-4">
		<!-- Literal class names, not `text-cmc-${tone}` — Tailwind's scanner only
		     sees names written out in full, so a computed one emits no CSS. -->
		<h1
			class="text-5xl leading-tight font-bold tracking-tight text-balance {tone === 'teal'
				? 'text-cmc-teal'
				: 'text-cmc-navy'}"
		>
			{title}
		</h1>
		{#if children}
			<p class="text-lg leading-relaxed text-fg-2">{@render children()}</p>
		{/if}
		{#if actions}
			<div class="mt-4 flex flex-col items-center gap-3">{@render actions()}</div>
		{/if}
	</div>
</Section>
