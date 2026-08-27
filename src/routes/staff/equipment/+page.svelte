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
	import { getStaffEquipmentList } from '$lib/remote/equipment.remote';
	import CategoryOptions from '$lib/components/equipment/CategoryOptions.svelte';
	import CategoryManagerModal from '$lib/components/equipment/CategoryManagerModal.svelte';
	import { equipmentStatuses, equipmentConditionBadge } from '$lib/config';
	import type { EquipmentCondition } from '$lib/server/db/schema/equipment';
	import { AddEquipmentAction } from '$lib/components/actions';
	import Button from '$lib/components/ui/Button.svelte';
	import { titleCase } from '$lib/utils/format';

	// `searchText`, not `search`: FilterBar's always-visible slot is a snippet
	// named `search`, and a snippet shadows a same-named script binding.
	let searchText = $state('');
	let categoryId = $state('');
	let statusFilter = $state('');
	let includeDeleted = $state(false);
	let page = $state(1);

	let searchDebounced = $state('');
	let filters = $derived({
		search: searchDebounced || undefined,
		categoryId: categoryId || undefined,
		status: statusFilter || undefined,
		includeDeleted: includeDeleted || undefined,
		page
	});

	// The page's one query. The category list moved into the two components that need it —
	// see CategoryOptions for why it could not be composed into this one.
	let result = $derived(getStaffEquipmentList(filters));

	let showCategoryModal = $state(false);

	const activeFilterCount = $derived(
		(searchDebounced ? 1 : 0) +
			(categoryId ? 1 : 0) +
			(statusFilter ? 1 : 0) +
			(includeDeleted ? 1 : 0)
	);

	function clearFilters() {
		searchText = '';
		searchDebounced = '';
		categoryId = '';
		statusFilter = '';
		includeDeleted = false;
		page = 1;
	}
</script>

<PageHeader title="Equipment">
	<div class="flex gap-2">
		<Button variant="ghost" size="sm" onclick={() => (showCategoryModal = true)}>Categories</Button>
		<AddEquipmentAction />
	</div>
</PageHeader>
<PageContent>
	<FilterBar activeCount={activeFilterCount} onclear={clearFilters}>
		{#snippet search()}
			<SearchInput
				bind:value={searchText}
				placeholder="Search name, serial, resource ID..."
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
			aria-label="Status"
			value={statusFilter}
			onchange={(e: Event) => {
				statusFilter = (e.currentTarget as HTMLSelectElement).value;
				page = 1;
			}}
		>
			<option value="">All statuses</option>
			{#each equipmentStatuses as s (s)}
				<option value={s}>{titleCase(s)}</option>
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

	<DataList {result} empty="No equipment found" onpage={(p) => (page = p)}>
		{#snippet children(equipment)}
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">Status</span></th>
					<th>Equipment</th>
					<th class="col-support">Condition</th>
					<th class="cell-num">Available</th>
					<th class="col-extra">Resource ID</th>
				{/snippet}

				{#each equipment as e (e.id)}
					{@const href = resolve(`/staff/equipment/${e.id}`)}
					<tr class="hover cursor-pointer" class:opacity-50={e.deletedAt} use:rowLink={href}>
						<td class="w-px">
							<StatusBadge status={e.deletedAt ? 'deactivated' : e.status} />
						</td>
						<!-- Category was its own column; as the ref's subline it costs no width. -->
						<td class="cell-primary"><EntityIdentity ref={e.ref} /></td>
						<td class="col-support">
							<Badge
								size="sm"
								class={equipmentConditionBadge[e.condition as EquipmentCondition] ?? 'badge-ghost'}
							>
								{titleCase(e.condition)}
							</Badge>
						</td>
						<td class="cell-num">
							<span class:text-error={e.availableQuantity <= 0}>
								{e.availableQuantity} / {e.totalQuantity}
							</span>
						</td>
						<td class="col-extra">
							{#if e.resourceId}
								<span class="font-mono text-xs">{e.resourceId}</span>
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
