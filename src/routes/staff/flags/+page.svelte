<script lang="ts">
	import SearchInput from '$lib/components/ui/Form/SearchInput.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import DataList from '$lib/components/ui/DataList.svelte';
	import FilterBar from '$lib/components/ui/FilterBar.svelte';
	import Select from '$lib/components/ui/Form/Select.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import { EntityIdentity } from '$lib/components/ui/entity';
	import { rowLink } from '$lib/actions/row-link';
	import { entityLabels } from '$lib/config';
	import { resolve } from '$app/paths';
	import { relativeDay } from '$lib/utils/format';
	import { getFlagsQueue } from '$lib/remote/flags.remote';

	const flagStatuses = ['pending', 'resolved', 'dismissed'] as const;

	// `searchText`, not `search`: FilterBar's always-visible slot is a snippet
	// named `search`, and a snippet shadows a same-named script binding.
	let searchText = $state('');
	let statusFilter = $state<'pending' | 'resolved' | 'dismissed' | ''>('pending');
	let page = $state(1);

	let searchDebounced = $state('');
	let filters = $derived({
		search: searchDebounced || undefined,
		status: (statusFilter || undefined) as (typeof flagStatuses)[number] | undefined,
		page
	});

	let result = $derived(getFlagsQueue(filters));

	const activeFilterCount = $derived(
		(searchDebounced ? 1 : 0) + (statusFilter === 'pending' ? 0 : 1)
	);

	function clearFilters() {
		searchText = '';
		searchDebounced = '';
		statusFilter = 'pending';
		page = 1;
	}
</script>

<PageHeader title="Content Flags" />
<PageContent>
	<FilterBar activeCount={activeFilterCount} onclear={clearFilters}>
		{#snippet search()}
			<SearchInput
				bind:value={searchText}
				placeholder="Search reason..."
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
			{#each flagStatuses as s (s)}
				<option value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
			{/each}
		</Select>
	</FilterBar>

	<!--
		A table: the reason is capped at 100 characters (`FLAG_REASON_MAX`) and the
		queue has no row actions, so it passes none of the four card tests
		(ui-patterns.md, "A table, unless the row earns a card"). The old comment
		here claimed unbounded prose, which is what #1034 was about.
	-->
	<DataList {result} empty="No flags found" onpage={(p) => (page = p)}>
		{#snippet children(flags)}
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">Status</span></th>
					<th class="col-support">Type</th>
					<th>Flagged</th>
					<th class="cell-primary">Reason</th>
					<th class="col-support">Reported by</th>
					<th class="col-support">When</th>
				{/snippet}
				{#each flags as f (f.id)}
					<tr class="hover cursor-pointer" use:rowLink={resolve(`/staff/flags/${f.id}`)}>
						<td class="w-px"><StatusBadge status={f.status} label /></td>
						<!-- Its own column, not a glyph: `ref.type` is `flag` for every row
						     (flag-service.ts), so the registry glyph marks nothing and what
						     was flagged is only in `target.type`. -->
						<td class="col-support whitespace-nowrap">{entityLabels[f.target.type].one}</td>
						<td class="whitespace-nowrap"><EntityIdentity ref={f.ref} /></td>
						<td class="cell-primary truncate">{f.reason}</td>
						<td class="col-support truncate">{f.reportedByName ?? 'Anonymous visitor'}</td>
						<td class="col-support whitespace-nowrap">{relativeDay(f.createdAt)}</td>
					</tr>
				{/each}
			</Table>
		{/snippet}
	</DataList>
</PageContent>
