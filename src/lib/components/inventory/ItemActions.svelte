<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import Button from '#lib/components/ui/Button.svelte';
	import { hasCapability, type InventorySection } from '#lib/config.js';
	import { getStaffLayout } from '#lib/remote/layout.remote.js';
	import TaggingQueue from './TaggingQueue.svelte';

	let { section }: { section: InventorySection } = $props();

	// Its own component so the page keeps one query of its own. The staff layout
	// has already fetched this; the call dedupes to it.
	const caps = $derived((await getStaffLayout()).capabilities);
</script>

<!-- Only gear has units to tag. -->
{#if section === 'gear' && hasCapability(caps, 'inventory.manageAssets')}
	<TaggingQueue />
{/if}
<!-- Not Add Item: this records an arrival against items that already exist —
     source, cost, quantities, each unit's tag — as one acquisition (#1838).
     One intake for both lists: each line files under its item's section. -->
{#if hasCapability(caps, 'inventory.manageStock')}
	<Button variant="ghost" size="sm" href={resolve('staff/inventory/intake')}
		>{m.staff_receive_stock_label()}</Button
	>
{/if}
