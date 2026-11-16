<!--
	Test harness: two boundaries still on their first load, each with its own read,
	which `refresh` replaces together as `refreshAll()` does. Work in a boundary
	that has not rendered does not block a batch, so the refresh can run its effects
	and stay open while `other` is out.
-->
<script lang="ts">
	import TabBarRefresh from './TabBarRefresh.test.svelte';

	let {
		onerror,
		tabsRead,
		otherRead
	}: {
		onerror: (error: unknown) => void;
		tabsRead: Promise<number>;
		otherRead: Promise<number>;
	} = $props();

	// svelte-ignore state_referenced_locally
	let reads = $state.raw({ tabs: tabsRead, other: otherRead });

	export function refresh(tabs: Promise<number>, other: Promise<number>) {
		reads = { tabs, other };
	}
</script>

{#snippet loading()}
	<span></span>
{/snippet}

<svelte:boundary {onerror} pending={loading}>
	<TabBarRefresh read={reads.tabs} />
</svelte:boundary>

<svelte:boundary {onerror} pending={loading}>
	<output>{await reads.other}</output>
</svelte:boundary>
