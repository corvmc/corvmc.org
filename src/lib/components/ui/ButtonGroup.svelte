<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		children,
		vertical = false,
		wrap = false,
		class: className = '',
		style = ''
	}: {
		children: Snippet;
		vertical?: boolean;
		wrap?: boolean;
		class?: string;
		style?: string;
	} = $props();
</script>

<div class="button-group join {className}" class:join-vertical={vertical} class:wrap {style}>
	{@render children()}
</div>

<style>
	.button-group :global(.btn) {
		--shadow-color: var(--cmc-brown) !important;
	}

	.button-group.wrap {
		flex-wrap: wrap;
	}

	.button-group.wrap > :global(:not(:first-child)) {
		margin-inline-start: -2.5px;
	}

	.button-group.wrap > :global(*) {
		margin-block-end: -2.5px;
	}
</style>
