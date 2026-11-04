<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import SearchInput from '#lib/components/ui/Form/SearchInput.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import DataList from '#lib/components/ui/DataList.svelte';
	import FilterBar from '#lib/components/ui/FilterBar.svelte';
	import Select from '#lib/components/ui/Form/Select.svelte';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import { rowLink } from '#lib/actions/row-link.js';
	import { resolve } from '$app/paths';
	import { formatDateShort } from '#lib/utils/format.js';
	import {
		incidentCategories,
		incidentCategoryLabels,
		type IncidentCategory,
		type IncidentStatusFilter
	} from '#lib/config.js';
	import { getIncidentLog } from '#lib/remote/incidents.remote.js';
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

<PageHeader title={m.staff_incidents_title()} subtitle={m.staff_space()}>
	{#if canRecord}
		<RecordIncidentAction />
	{/if}
</PageHeader>
<PageContent>
	<FilterBar activeCount={activeFilterCount} onclear={clearFilters}>
		{#snippet search()}
			<SearchInput
				bind:value={searchText}
				placeholder={m.staff_incidents_placeholder()}
				onsearch={(q) => {
					searchDebounced = q;
					page = 1;
				}}
			/>
		{/snippet}
		<Select
			size="sm"
			aria-label={m.staff_status()}
			value={statusFilter}
			onchange={(e: Event) => {
				statusFilter = (e.currentTarget as HTMLSelectElement).value as typeof statusFilter;
				page = 1;
			}}
		>
			<option value="">{m.staff_all_statuses()}</option>
			<option value="unresolved">{m.staff_incidents_not_resolved()}</option>
			<option value="reported">{m.staff_incidents_awaiting_review()}</option>
			<option value="open">{m.staff_open()}</option>
			<option value="resolved">{m.staff_resolved()}</option>
		</Select>
		<Select
			size="sm"
			aria-label={m.staff_category()}
			value={categoryFilter}
			onchange={(e: Event) => {
				categoryFilter = (e.currentTarget as HTMLSelectElement).value as typeof categoryFilter;
				page = 1;
			}}
		>
			<option value="">{m.staff_incidents_all_kinds()}</option>
			{#each incidentCategories as c (c)}
				<option value={c}>{incidentCategoryLabels[c]}</option>
			{/each}
		</Select>
	</FilterBar>

	<!-- A table: the summary is capped at 200 characters and rows carry no actions. -->
	<DataList {result} empty={m.staff_incidents_empty()} onpage={(p) => (page = p)}>
		{#snippet children(rows)}
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">{m.staff_status()}</span></th>
					<th class="col-support">{m.staff_when()}</th>
					<th class="col-support">{m.staff_kind()}</th>
					<th class="cell-primary">{m.staff_summary()}</th>
					<th class="col-support">{m.staff_member_involved()}</th>
					<th class="col-support">{m.staff_recorded_by()}</th>
				{/snippet}
				{#each rows as r (r.id)}
					<tr class="hover cursor-pointer" use:rowLink={resolve(`staff/incidents/${r.id}`)}>
						<td class="w-px"><StatusBadge status={r.status} label /></td>
						<td class="col-support whitespace-nowrap">{formatDateShort(r.occurredAt)}</td>
						<td class="col-support whitespace-nowrap">{incidentCategoryLabels[r.category]}</td>
						<td class="cell-primary truncate">{r.summary}</td>
						<td class="col-support cell-text truncate">{r.involvedName ?? '—'}</td>
						<td class="col-support cell-text truncate">{r.reportedByName}</td>
					</tr>
				{/each}
			</Table>
		{/snippet}
	</DataList>
</PageContent>
