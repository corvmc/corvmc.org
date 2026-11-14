<script lang="ts">
	import type { Snippet } from 'svelte';
	import { hasCapability, type Capability } from '#lib/config.js';
	import { getStaffLayout } from '#lib/remote/layout.remote.js';

	/**
	 * Renders its children only for a viewer holding `cap`. Presentation only:
	 * the remote behind what it hides is the guard.
	 */
	let { cap, children }: { cap: Capability; children: Snippet } = $props();

	// The staff layout already fetched this; the call dedupes to it.
	const held = $derived(hasCapability((await getStaffLayout()).capabilities, cap));
</script>

{#if held}{@render children()}{/if}
