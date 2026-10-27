<script lang="ts">
	import { resolve } from '$app/paths';
	import Button from '$lib/components/ui/Button.svelte';
	import { hasCapability } from '$lib/config';
	import { getStaffLayout } from '$lib/remote/layout.remote';
	import TaggingQueue from './TaggingQueue.svelte';

	// Its own component so the page keeps one query of its own. The staff layout
	// has already fetched this; the call dedupes to it.
	const caps = $derived((await getStaffLayout()).capabilities);
</script>

{#if hasCapability(caps, 'inventory.manageAssets')}
	<TaggingQueue />
{/if}
<!-- Not Add Item: this records an arrival against items that already exist —
     source, cost, quantities, each unit's tag — as one acquisition (#1838). -->
{#if hasCapability(caps, 'inventory.manageStock')}
	<Button variant="ghost" size="sm" href={resolve('/staff/inventory/intake')}>Receive Stock</Button>
{/if}
