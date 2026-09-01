<script lang="ts">
	/**
	 * The bar above the queue: what this is, how much of it there is, and the way
	 * into Daily.
	 *
	 * The counts are the same query the tabs read, so they cost nothing extra —
	 * this states the two numbers worth seeing without opening a tab (what needs
	 * you, what you have cleared) while the tabs carry the rest.
	 */
	import type { Snippet } from 'svelte';

	let {
		open,
		resolved,
		action
	}: {
		open: number;
		resolved: number;
		/** The Start Daily entry point. Absent until there is a session to start. */
		action?: Snippet;
	} = $props();
</script>

<div class="flex flex-wrap items-center justify-between gap-2">
	<div class="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
		<h1 class="text-xl font-bold">Inbox</h1>
		<p class="text-subtle text-sm">Open {open} · Resolved {resolved}</p>
	</div>
	{#if action}{@render action()}{/if}
</div>
