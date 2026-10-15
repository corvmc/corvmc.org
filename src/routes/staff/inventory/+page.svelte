<script lang="ts">
	import SearchInput from '$lib/components/ui/Form/SearchInput.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import DataList from '$lib/components/ui/DataList.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import FilterBar from '$lib/components/ui/FilterBar.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import { EntityIdentity } from '$lib/components/ui/entity';
	import Badge from '$lib/components/ui/Badge.svelte';
	import { rowLink } from '$lib/actions/row-link';
	import { resolve } from '$app/paths';
	import { Select } from '$lib/components/ui/Form';
	import { getStaffItemList } from '$lib/remote/inventory.remote';
	import CategoryOptions from '$lib/components/inventory/CategoryOptions.svelte';
	import CategoryManagerModal from '$lib/components/inventory/CategoryManagerModal.svelte';
	import { itemKinds } from '$lib/config';
	import { AddItemAction } from '$lib/components/actions';
	import IntakeButton from './IntakeButton.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { titleCase } from '$lib/utils/format';
	import BarcodeScanner from '$lib/components/ui/BarcodeScanner.svelte';
	import { parseScan } from '$lib/utils/scan';

	// `searchText`, not `search`: FilterBar's always-visible slot is a snippet
	// named `search`, and a snippet shadows a same-named script binding.
	let searchText = $state('');
	let categoryId = $state('');
	let kindFilter = $state('');
	let includeDeleted = $state(false);
	let page = $state(1);

	let searchDebounced = $state('');

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
		page
	});

	// The page's one query. The category list moved into the two components that need it —
	// see CategoryOptions for why it could not be composed into this one.
	let result = $derived(getStaffItemList(filters));

	let showCategoryModal = $state(false);

	const menuFilterCount = $derived((kindFilter ? 1 : 0) + (includeDeleted ? 1 : 0));
	const activeFilterCount = $derived(
		(searchDebounced ? 1 : 0) + (categoryId ? 1 : 0) + menuFilterCount
	);

	function clearFilters() {
		searchText = '';
		searchDebounced = '';
		categoryId = '';
		kindFilter = '';
		includeDeleted = false;
		page = 1;
	}
</script>

<PageHeader title="Inventory">
	<div class="flex gap-2">
		<Button variant="ghost" size="sm" href={resolve('/staff/inventory/locations')}>Locations</Button
		>
		<Button variant="ghost" size="sm" onclick={() => (showCategoryModal = true)}>Categories</Button>
		<IntakeButton />
		<AddItemAction />
	</div>
</PageHeader>
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
			<div
				class="flex flex-wrap [&:not(:has(video))>input]:rounded-e-none [&>.scan-cap:has(video)]:mt-2 [&>.scan-cap:has(video)]:w-full [&>.scan-cap:not(:has(video))_.btn]:-ms-px [&>.scan-cap:not(:has(video))_.btn]:rounded-s-none [&>input]:w-auto [&>input]:min-w-0 [&>input]:flex-1"
			>
				<SearchInput
					bind:value={searchText}
					placeholder="Search name, barcode, resource ID..."
					onsearch={(q) => {
						searchDebounced = q;
						page = 1;
					}}
				/>
				<!-- The box already carries a UPC, so scanning it beats reading twelve
				     digits off a shrink-wrapped packet. Search matches `gtin`, so the
				     digits go straight in; a tag scan searches on the tag instead. -->
				<BarcodeScanner onscan={handleScan} label="Scan" class="scan-cap" />
			</div>
		{/snippet}
		<Select
			size="sm"
			aria-label="Category"
			value={categoryId}
			onchange={(e: Event) => {
				categoryId = (e.currentTarget as HTMLSelectElement).value;
				page = 1;
			}}
		>
			<option value="">All categories</option>
			<CategoryOptions />
		</Select>
		{#snippet menu()}
			<label class="flex flex-col gap-1">
				<span class="text-muted text-xs">Tracking</span>
				<Select
					size="sm"
					value={kindFilter}
					onchange={(e: Event) => {
						kindFilter = (e.currentTarget as HTMLSelectElement).value;
						page = 1;
					}}
				>
					<option value="">All items</option>
					{#each itemKinds as k (k)}
						<option value={k}>{titleCase(k)}</option>
					{/each}
				</Select>
			</label>
			<!-- Deactivation is a soft delete, so without this the only way back to a
			     deactivated item (and its Reactivate button) is a hand-typed URL. -->
			<label class="label cursor-pointer gap-2 text-sm">
				<input
					type="checkbox"
					class="checkbox checkbox-sm"
					bind:checked={includeDeleted}
					onchange={() => (page = 1)}
				/>
				Show deactivated
			</label>
		{/snippet}
	</FilterBar>

	<DataList {result} empty="No items found" onpage={(p) => (page = p)}>
		{#snippet children(equipment)}
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">Status</span></th>
					<th>Item</th>
					<th class="col-support">Category</th>
					<th class="col-support">Tracking</th>
					<th class="cell-num">Available</th>
					<th class="col-support cell-num">Total</th>
				{/snippet}

				{#each equipment as e (e.id)}
					{@const href = resolve(`/staff/inventory/${e.id}`)}
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
						<td class="col-support whitespace-nowrap">
							<Badge size="sm" class="badge-ghost">{titleCase(e.kind)}</Badge>
							{#if e.isConsumable}
								<Badge size="sm" class="badge-ghost">Consumable</Badge>
							{/if}
						</td>
						<td class="cell-num">
							<span class:text-error={e.availableQuantity <= 0}>{e.availableQuantity}</span>
						</td>
						<td class="col-support cell-num">
							<!-- Low stock is the reorder point doing its job: the colour says so. -->
							<span
								class:text-warning={e.isLowStock}
								class:font-semibold={e.isLowStock}
								title={e.isLowStock ? 'Low stock' : undefined}>{e.onHand}</span
							>
						</td>
					</tr>
				{/each}
			</Table>
		{/snippet}
	</DataList>
</PageContent>
<CategoryManagerModal bind:open={showCategoryModal} />
