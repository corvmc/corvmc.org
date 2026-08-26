<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * The centred title block that opens a `Section` — eyebrow, heading, and an
	 * optional line of lede beneath.
	 *
	 * `eyebrow` renders whatever you give it (usually a `sticker-badge`), so the
	 * brand chips stay where they are rather than being absorbed into a prop.
	 */
	let {
		title,
		eyebrow,
		children
	}: {
		title: string;
		eyebrow?: Snippet;
		/** Lede paragraph under the heading. */
		children?: Snippet;
	} = $props();
</script>

<div class="mb-12 text-center">
	{@render eyebrow?.()}
	<h2 class="mb-3 text-4xl font-bold tracking-tight">{title}</h2>
	{#if children}
		<p class="mx-auto max-w-2xl text-base leading-relaxed text-fg-2">{@render children()}</p>
	{/if}
</div>
