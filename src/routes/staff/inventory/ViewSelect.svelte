<script lang="ts">
	import { Select } from '$lib/components/ui/Form';
	import {
		hasCapability,
		inventoryListViews,
		inventoryListViewMeta,
		type InventoryListView
	} from '$lib/config';
	import { getStaffLayout } from '$lib/remote/layout.remote';

	let {
		value,
		onchange
	}: { value: InventoryListView | ''; onchange: (v: InventoryListView | '') => void } = $props();

	// Its own component so the page keeps one query; the staff layout already fetched this.
	const caps = $derived((await getStaffLayout()).capabilities);
	const views = $derived(
		inventoryListViews.filter((v) => hasCapability(caps, inventoryListViewMeta[v].capability))
	);
</script>

<Select
	size="sm"
	aria-label="Show"
	{value}
	onchange={(e: Event) =>
		onchange((e.currentTarget as HTMLSelectElement).value as InventoryListView | '')}
>
	<option value="">All items</option>
	{#each views as v (v)}
		<option value={v}>{inventoryListViewMeta[v].label}</option>
	{/each}
</Select>
