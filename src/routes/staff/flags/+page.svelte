<script lang="ts">
	import SearchInput from '$lib/components/ui/Form/SearchInput.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import DataList from '$lib/components/ui/DataList.svelte';
	import FilterBar from '$lib/components/ui/FilterBar.svelte';
	import Select from '$lib/components/ui/Form/Select.svelte';
	import { entityLabels } from '$lib/config';
	import { resolve } from '$app/paths';
	import { getFlagsQueue } from '$lib/remote/flags.remote';
	import TriageTable from './TriageTable.svelte';
	import TriageTabs from './TriageTabs.svelte';

	const flagStatuses = ['pending', 'resolved', 'dismissed'] as const;

	// `searchText`, not `search`: FilterBar's always-visible slot is a snippet
	// named `search`, and a snippet shadows a same-named script binding.
	let searchText = $state('');
	let statusFilter = $state<'pending' | 'resolved' | 'dismissed' | 'appealed' | ''>('pending');
	let page = $state(1);

	let searchDebounced = $state('');
	let filters = $derived({
		search: searchDebounced || undefined,
		// "Appealed" is not a flag status — an appeal hangs off a resolved flag.
		status:
			statusFilter === 'appealed'
				? undefined
				: ((statusFilter || undefined) as (typeof flagStatuses)[number] | undefined),
		appealPending: statusFilter === 'appealed' || undefined,
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
	<TriageTabs active="content" />
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
			<option value="appealed">Appeal waiting</option>
		</Select>
	</FilterBar>

	<DataList {result} empty="No flags found" onpage={(p) => (page = p)}>
		{#snippet children(flags)}
			<!-- `ref.type` is `flag` for every row, so what was flagged is the
			     type column, read from `target.type`. -->
			<TriageTable
				subjectLabel="Flagged"
				rows={flags.map((f) => ({
					id: f.id,
					href: resolve(`/staff/flags/${f.id}`),
					status: f.status,
					kind: entityLabels[f.target.type].one,
					subject: f.ref,
					text: f.reason,
					appealed: f.appeal === 'pending',
					reporter: f.reportedByName ?? 'Anonymous visitor',
					createdAt: f.createdAt
				}))}
			/>
		{/snippet}
	</DataList>
</PageContent>
