<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { Select } from '#lib/components/ui/Form/index.js';
	import {
		hasCapability,
		inventoryListViews,
		inventoryListViewMeta,
		type InventoryListView
	} from '#lib/config.js';
	import { getStaffLayout } from '#lib/remote/layout.remote.js';

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
	aria-label={m.staff_show()}
	{value}
	onchange={(e: Event) =>
		onchange((e.currentTarget as HTMLSelectElement).value as InventoryListView | '')}
>
	<option value="">{m.staff_all_items()}</option>
	{#each views as v (v)}
		<option value={v}>{inventoryListViewMeta[v].label}</option>
	{/each}
</Select>
