<script lang="ts" module>
	const SIZES = { sm: 'text-sm', base: 'text-base', lg: 'text-lg' } as const;

	export type CardTitleSize = keyof typeof SIZES;
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import clsx from 'clsx';

	/**
	 * A card's heading. `size` overrides daisyUI's own `card-title` size, which
	 * is too loud for a card inside a grid of cards — the reason `card-title
	 * text-lg` and `card-title text-base` were both in circulation.
	 *
	 * `level` is the heading level, not a size — pages put cards at different
	 * depths (a top-level section is an `<h2>` under `PageHeader`'s `<h1>`; a card
	 * inside a section is an `<h3>`) and the outline has to stay honest for screen
	 * readers. Change `size` to make it look smaller, never `level`.
	 */
	let {
		size,
		level = 3,
		class: className = '',
		children
	}: {
		size?: CardTitleSize;
		/** Heading level. Pick it from the page outline, not from how big it looks. */
		level?: 2 | 3 | 4;
		class?: string;
		children: Snippet;
	} = $props();
</script>

<svelte:element this={`h${level}`} class={clsx('card-title', size && SIZES[size], className)}>
	{@render children()}
</svelte:element>
