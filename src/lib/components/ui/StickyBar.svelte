<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * A bar that stays at the bottom of a long list.
	 *
	 * Extracted because two inventory screens grew the same one — the intake
	 * editor's running tally and the restock list's order button — and both are
	 * the same situation: the list is longer than the viewport, and the thing you
	 * do with it has to stay reachable without scrolling back. It is a component
	 * rather than a class list for the reason `no-utility-soup` gives: six
	 * non-layout utilities repeated in two places is a component that has not
	 * been named yet.
	 */
	let { children, class: className = '' }: { children: Snippet; class?: string } = $props();
</script>

<div class="sticky-bar {className}">
	{@render children()}
</div>

<style>
	.sticky-bar {
		position: sticky;
		bottom: 0;
		border-top: 1px solid var(--color-base-300);
		background-color: var(--color-base-100);
		padding-block: calc(var(--spacing) * 3);
	}
</style>
