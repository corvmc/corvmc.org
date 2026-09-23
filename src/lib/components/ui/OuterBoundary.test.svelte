<script lang="ts">
	import type { Component } from 'svelte';

	/** Stands in for the caller's boundary, so a spec can tell whose boundary caught. */
	let {
		inner: Inner,
		innerProps
	}: { inner: Component<Record<string, unknown>>; innerProps: Record<string, unknown> } = $props();
</script>

<svelte:boundary>
	<Inner {...innerProps} />

	{#snippet failed(error)}
		<p data-outer-failed>{String(error)}</p>
	{/snippet}
</svelte:boundary>
