<script lang="ts">
	import SearchInput from '$lib/components/ui/Form/SearchInput.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import DataList from '$lib/components/ui/DataList.svelte';
	import FilterBar from '$lib/components/ui/FilterBar.svelte';
	import Select from '$lib/components/ui/Form/Select.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import { rowLink } from '$lib/actions/row-link';
	import { resolve } from '$app/paths';
	import { formatDateShort } from '$lib/utils/format';
	import {
		incidentCategories,
		incidentCategoryLabels,
		type IncidentCategory,
		type IncidentStatusFilter
	} from '$lib/config';
	import { getIncidentLog } from '$lib/remote/incidents.remote';
	import RecordIncidentAction from './RecordIncidentAction.svelte';

	let searchText = $state('');
	let searchDebounced = $state('');
	let statusFilter = $state<IncidentStatusFilter | ''>('unresolved');
	let categoryFilter = $state<IncidentCategory | ''>('');
	let page = $state(1);

	let result = $derived(
		getIncidentLog({
			status: statusFilter || undefined,
			category: categoryFilter || undefined,
			search: searchDebounced || undefined,
			page
		})
	);

	const canRecord = $derived(result.current?.canRecord ?? false);

	const activeFilterCount = $derived(
		(searchDebounced ? 1 : 0) + (statusFilter === 'unresolved' ? 0 : 1) + (categoryFilter ? 1 : 0)
	);

	function clearFilters() {
		searchText = '';
		searchDebounced = '';
		statusFilter = 'unresolved';
		categoryFilter = '';
		page = 1;
	}
</script>

<PageHeader title="Incidents" subtitle="Space">
	{#if canRecord}
		<RecordIncidentAction />
	{/if}
</PageHeader>
<PageContent>
	<FilterBar activeCount={activeFilterCount} onclear={clearFilters}>
		{#snippet search()}
			<SearchInput
				bind:value={searchText}
				placeholder="Search incidents..."
				onsearch={(q) => {
					searchDebounced = q;
					page = 1;
				}}
			/>
		{/snippet}
		<Select
			size="sm"
			aria-label="Status"
			value={statusFilter}
			onchange={(e: Event) => {
				statusFilter = (e.currentTarget as HTMLSelectElement).value as typeof statusFilter;
				page = 1;
			}}
		>
			<option value="">All statuses</option>
			<option value="unresolved">Not resolved</option>
			<option value="reported">Awaiting review</option>
			<option value="open">Open</option>
			<option value="resolved">Resolved</option>
		</Select>
		<Select
			size="sm"
			aria-label="Category"
			value={categoryFilter}
			onchange={(e: Event) => {
				categoryFilter = (e.currentTarget as HTMLSelectElement).value as typeof categoryFilter;
				page = 1;
			}}
		>
			<option value="">All kinds</option>
			{#each incidentCategories as c (c)}
				<option value={c}>{incidentCategoryLabels[c]}</option>
			{/each}
		</Select>
	</FilterBar>

	<!-- A table: the summary is capped at 200 characters and rows carry no actions. -->
	<DataList {result} empty="No incidents found" onpage={(p) => (page = p)}>
		{#snippet children(rows)}
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">Status</span></th>
					<th class="col-support">When</th>
					<th class="col-support">Kind</th>
					<th class="cell-primary">Summary</th>
					<th class="col-support">Member involved</th>
					<th class="col-support">Recorded by</th>
				{/snippet}
				{#each rows as r (r.id)}
					<tr class="hover cursor-pointer" use:rowLink={resolve(`/staff/incidents/${r.id}`)}>
						<td class="w-px"><StatusBadge status={r.status} label /></td>
						<td class="col-support whitespace-nowrap">{formatDateShort(r.occurredAt)}</td>
						<td class="col-support whitespace-nowrap">{incidentCategoryLabels[r.category]}</td>
						<td class="cell-primary truncate">{r.summary}</td>
						<td class="col-support truncate">{r.involvedName ?? '—'}</td>
						<td class="col-support truncate">{r.reportedByName}</td>
					</tr>
				{/each}
			</Table>
		{/snippet}
	</DataList>
</PageContent>
