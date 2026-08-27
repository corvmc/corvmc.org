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
	import Button from '$lib/components/ui/Button.svelte';
	import { titleCase } from '$lib/utils/format';

	// `searchText`, not `search`: FilterBar's always-visible slot is a snippet
	// named `search`, and a snippet shadows a same-named script binding.
	let searchText = $state('');
	let categoryId = $state('');
	let kindFilter = $state('');
	let includeDeleted = $state(false);
	let page = $state(1);

	let searchDebounced = $state('');
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

	const activeFilterCount = $derived(
		(searchDebounced ? 1 : 0) +
			(categoryId ? 1 : 0) +
			(kindFilter ? 1 : 0) +
			(includeDeleted ? 1 : 0)
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
		<Button variant="ghost" size="sm" onclick={() => (showCategoryModal = true)}>Categories</Button>
		<AddItemAction />
	</div>
</PageHeader>
<PageContent>
	<FilterBar activeCount={activeFilterCount} onclear={clearFilters}>
		{#snippet search()}
			<SearchInput
				bind:value={searchText}
				placeholder="Search name, barcode, resource ID..."
				onsearch={(q) => {
					searchDebounced = q;
					page = 1;
				}}
			/>
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
		<Select
			size="sm"
			aria-label="Tracking"
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
	</FilterBar>

	<DataList {result} empty="No items found" onpage={(p) => (page = p)}>
		{#snippet children(equipment)}
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">Status</span></th>
					<th>Item</th>
					<th class="col-support">Tracking</th>
					<th class="cell-num">Available</th>
					<th class="cell-num col-support">On hand</th>
					<th class="col-extra">Barcode</th>
				{/snippet}

				{#each equipment as e (e.id)}
					{@const href = resolve(`/staff/inventory/${e.id}`)}
					<tr class="hover cursor-pointer" class:opacity-50={e.deletedAt} use:rowLink={href}>
						<td class="w-px">
							<StatusBadge status={e.deletedAt ? 'deactivated' : 'active'} />
						</td>
						<!-- Category was its own column; as the ref's subline it costs no width. -->
						<td class="cell-primary"><EntityIdentity ref={e.ref} /></td>
						<td class="col-support">
							<Badge size="sm" class="badge-ghost">{titleCase(e.kind)}</Badge>
							{#if e.isConsumable}
								<Badge size="sm" class="badge-ghost">Consumable</Badge>
							{/if}
						</td>
						<td class="cell-num">
							<span class:text-error={e.availableQuantity <= 0}>{e.availableQuantity}</span>
						</td>
						<td class="cell-num col-support">
							<!-- Low stock is the reorder point doing its job: nobody has to
							     notice, so the row says so itself. -->
							<span class:text-warning={e.isLowStock}>{e.onHand}</span>
							{#if e.isLowStock}
								<Badge size="sm" class="badge-warning">Low</Badge>
							{/if}
						</td>
						<td class="col-extra">
							{#if e.gtin}
								<span class="font-mono text-xs">{e.gtin}</span>
							{:else}
								<span class="opacity-40">—</span>
							{/if}
						</td>
					</tr>
				{/each}
			</Table>
		{/snippet}
	</DataList>
</PageContent>
<CategoryManagerModal bind:open={showCategoryModal} />
