<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import SearchInput from '#lib/components/ui/Form/SearchInput.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import DataList from '#lib/components/ui/DataList.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import FilterBar from '#lib/components/ui/FilterBar.svelte';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import { EntityIdentity } from '#lib/components/ui/entity/index.js';
	import Badge from '#lib/components/ui/Badge.svelte';
	import { rowLink } from '#lib/actions/row-link.js';
	import { resolve } from '$app/paths';
	import { Select } from '#lib/components/ui/Form/index.js';
	import { getStaffItemList } from '#lib/remote/inventory.remote.js';
	import CategoryOptions from '#lib/components/inventory/CategoryOptions.svelte';
	import CategoryManagerModal from '#lib/components/inventory/CategoryManagerModal.svelte';
	import { itemKinds } from '#lib/config.js';
	import { AddItemAction } from '#lib/components/actions/index.js';
	import ItemActions from './ItemActions.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import { titleCase } from '#lib/utils/format.js';
	import BarcodeScanner from '#lib/components/ui/BarcodeScanner.svelte';
	import { parseScan } from '#lib/utils/scan.js';
	import { page as pageState } from '$app/state';
	import { goto } from '$app/navigation';
	import {
		inventorySectionViews,
		type InventoryListView,
		type InventorySection
	} from '#lib/config.js';
	import ViewSelect from './ViewSelect.svelte';
	import RestockList from './RestockList.svelte';

	/**
	 * Gear or Supplies (#2573). The server filters by section, so a page holds
	 * only its own items; the page around this supplies the header.
	 */
	let { section }: { section: InventorySection } = $props();

	// `searchText`, not `search`: FilterBar's always-visible slot is a snippet
	// named `search`, and a snippet shadows a same-named script binding.
	let searchText = $state('');
	let categoryId = $state('');
	let kindFilter = $state('');
	let includeDeleted = $state(false);
	let page = $state(1);

	let searchDebounced = $state('');

	// `?show=` is the linkable part: the old Restock and Orders URLs redirect to it.
	const view = $derived.by((): InventoryListView | '' => {
		const v = pageState.url.searchParams.get('show');
		return (inventorySectionViews[section] as readonly string[]).includes(v ?? '')
			? (v as InventoryListView)
			: '';
	});

	function setView(v: InventoryListView | '') {
		const url = new URL(pageState.url.href);
		if (v) url.searchParams.set('show', v);
		else url.searchParams.delete('show');
		page = 1;
		goto(url, { replace: true, reset: false });
	}

	/**
	 * Whatever was scanned becomes the search term. A consumable's own barcode
	 * matches `gtin`; an asset tag scanned off a sticker is unwrapped from its
	 * `/a/{tag}` URL first, or it would search for a URL and find nothing.
	 */
	function handleScan(raw: string) {
		searchText = parseScan(raw).value;
		searchDebounced = searchText;
		page = 1;
	}
	let filters = $derived({
		search: searchDebounced || undefined,
		categoryId: categoryId || undefined,
		kind: kindFilter || undefined,
		includeDeleted: includeDeleted || undefined,
		section,
		view: view && view !== 'restock' ? view : undefined,
		page
	});

	// The page's one query. The category list moved into the two components that need it —
	// see CategoryOptions for why it could not be composed into this one.
	let result = $derived(view === 'restock' ? null : getStaffItemList(filters));

	let showCategoryModal = $state(false);

	const menuFilterCount = $derived((kindFilter ? 1 : 0) + (includeDeleted ? 1 : 0));
	const activeFilterCount = $derived(
		(searchDebounced ? 1 : 0) + (categoryId ? 1 : 0) + (view ? 1 : 0) + menuFilterCount
	);

	function clearFilters() {
		searchText = '';
		searchDebounced = '';
		categoryId = '';
		kindFilter = '';
		includeDeleted = false;
		page = 1;
		if (view) setView('');
	}
</script>

<PageContent>
	<FilterBar
		activeCount={activeFilterCount}
		menuCount={menuFilterCount}
		onclear={clearFilters}
		searchWidth="wide"
	>
		{#snippet search()}
			<!-- One control: Scan is the search box's end cap. While the camera is
			     open the scanner takes its own line, for the preview and Stop. -->
			<div class="scan-search flex flex-wrap">
				<SearchInput
					bind:value={searchText}
					placeholder={m.staff_inventory_placeholder()}
					onsearch={(q) => {
						searchDebounced = q;
						page = 1;
					}}
				/>
				<!-- The box already carries a UPC, so scanning it beats reading twelve
				     digits off a shrink-wrapped packet. Search matches `gtin`, so the
				     digits go straight in; a tag scan searches on the tag instead. -->
				<BarcodeScanner onscan={handleScan} label={m.staff_inventory_label()} class="scan-cap" />
			</div>
		{/snippet}
		<ViewSelect {section} value={view} onchange={setView} />
		<Select
			size="sm"
			aria-label={m.staff_category_label()}
			value={categoryId}
			onchange={(e: Event) => {
				categoryId = (e.currentTarget as HTMLSelectElement).value;
				page = 1;
			}}
		>
			<option value="">{m.staff_inventory_all_categories_label()}</option>
			<CategoryOptions />
		</Select>
		{#snippet actions()}
			<Button variant="ghost" size="sm" href={resolve('staff/inventory/locations')}
				>{m.staff_locations_label()}</Button
			>
			<Button variant="ghost" size="sm" onclick={() => (showCategoryModal = true)}
				>{m.staff_inventory_categories_label()}</Button
			>
			<ItemActions {section} />
			<AddItemAction />
		{/snippet}
		{#snippet menu()}
			<!-- Supplies are all bulk, so only Gear has a tracking choice to make. -->
			{#if section === 'gear'}
				<label class="flex flex-col gap-1">
					<span class="text-muted text-xs">{m.staff_inventory_tracking_label()}</span>
					<Select
						size="sm"
						value={kindFilter}
						onchange={(e: Event) => {
							kindFilter = (e.currentTarget as HTMLSelectElement).value;
							page = 1;
						}}
					>
						<option value="">{m.staff_all_items_label()}</option>
						{#each itemKinds as k (k)}
							<option value={k}>{titleCase(k)}</option>
						{/each}
					</Select>
				</label>
			{/if}
			<!-- Deactivation is a soft delete, so without this the only way back to a
			     deactivated item (and its Reactivate button) is a hand-typed URL. -->
			<label class="label cursor-pointer gap-2 text-sm">
				<input
					type="checkbox"
					class="checkbox checkbox-sm"
					bind:checked={includeDeleted}
					onchange={() => (page = 1)}
				/>
				{m.staff_inventory_show_deactivated_label()}
			</label>
		{/snippet}
	</FilterBar>

	{#if view === 'restock'}
		<RestockList {section} search={searchDebounced} {categoryId} />
	{:else if result}
		<DataList {result} empty={m.staff_inventory_empty_body()} onpage={(p) => (page = p)}>
			{#snippet children(equipment)}
				<Table>
					{#snippet head()}
						<th class="w-px"><span class="sr-only">{m.staff_status_label()}</span></th>
						<th>{m.staff_item_label()}</th>
						<th class="col-support">{m.staff_category_label()}</th>
						{#if section === 'gear'}
							<th class="col-support">{m.staff_inventory_tracking_label()}</th>
						{/if}
						<th class="cell-num">{m.staff_available_label()}</th>
						<th class="col-support cell-num">{m.staff_total_label()}</th>
					{/snippet}

					{#each equipment as e (e.id)}
						{@const href = resolve(`staff/inventory/${e.id}`)}
						<tr class="hover cursor-pointer" class:opacity-50={e.deletedAt} use:rowLink={href}>
							<td class="w-px">
								<StatusBadge status={e.deletedAt ? 'deactivated' : 'active'} />
							</td>
							<td class="cell-primary">
								<!-- Category has its own column; below col-support's width it rides as the subline. -->
								<EntityIdentity ref={e.ref}>
									{#snippet subtitle()}<span class="@min-[32rem]:hidden">{e.category.name}</span
										>{/snippet}
								</EntityIdentity>
							</td>
							<td class="col-support whitespace-nowrap">{e.category.name}</td>
							{#if section === 'gear'}
								<td class="col-support whitespace-nowrap">
									<Badge size="sm" class="badge-ghost">{titleCase(e.kind)}</Badge>
								</td>
							{/if}
							<td class="cell-num">
								<span class:text-error={e.availableQuantity <= 0}>{e.availableQuantity}</span>
							</td>
							<td class="col-support cell-num">
								<!-- Low stock is the reorder point doing its job: the colour says so. -->
								<span
									class:text-warning={e.isLowStock}
									class:font-semibold={e.isLowStock}
									title={e.isLowStock ? m.staff_inventory_low_stock_label() : undefined}
									>{e.onHand}</span
								>
								{#if e.onOrder > 0}
									<Badge variant="info" size="xs"
										>{m.staff_inventory_order_label({ onOrder: e.onOrder })}</Badge
									>
								{/if}
							</td>
						</tr>
					{/each}
				</Table>
			{/snippet}
		</DataList>
	{/if}
</PageContent>
<CategoryManagerModal bind:open={showCategoryModal} />

<style>
	.scan-search > :global(input) {
		flex: 1;
		width: auto;
		min-width: 0;
	}
	.scan-search:not(:has(:global(video))) > :global(input) {
		border-start-end-radius: 0;
		border-end-end-radius: 0;
	}
	.scan-search > :global(.scan-cap:not(:has(video)) .btn) {
		margin-inline-start: -1px;
		border-start-start-radius: 0;
		border-end-start-radius: 0;
	}
	.scan-search > :global(.scan-cap:has(video)) {
		width: 100%;
		margin-top: 0.5rem;
	}
</style>
