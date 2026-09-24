<script lang="ts">
	import SearchInput from '$lib/components/ui/Form/SearchInput.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import DataList from '$lib/components/ui/DataList.svelte';
	import FilterBar from '$lib/components/ui/FilterBar.svelte';
	import Select from '$lib/components/ui/Form/Select.svelte';
	import { entityLabels } from '$lib/config';
	import { resolve } from '$app/paths';
	import { getEquipmentReportQueue } from '$lib/remote/work-requests.remote';
	import TriageTable from '../TriageTable.svelte';
	import TriageTabs from '../TriageTabs.svelte';

	const stages = [
		{ value: 'untriaged', label: 'Needs triage' },
		{ value: 'in_work_order', label: 'In a work order' },
		{ value: 'resolved', label: 'Resolved' },
		{ value: 'dismissed', label: 'Dismissed' }
	] as const;
	type Stage = (typeof stages)[number]['value'];

	let searchText = $state('');
	let searchDebounced = $state('');
	let stage = $state<Stage | ''>('untriaged');
	let page = $state(1);

	let result = $derived(
		getEquipmentReportQueue({
			stage: stage || undefined,
			search: searchDebounced || undefined,
			page
		})
	);

	const activeFilterCount = $derived((searchDebounced ? 1 : 0) + (stage === 'untriaged' ? 0 : 1));

	function clearFilters() {
		searchText = '';
		searchDebounced = '';
		stage = 'untriaged';
		page = 1;
	}
</script>

<PageHeader title="Equipment Reports" />
<PageContent>
	<TriageTabs active="equipment" />
	<FilterBar activeCount={activeFilterCount} onclear={clearFilters}>
		{#snippet search()}
			<SearchInput
				bind:value={searchText}
				placeholder="Search note, item or place..."
				onsearch={(q) => {
					searchDebounced = q;
					page = 1;
				}}
			/>
		{/snippet}
		<Select
			size="sm"
			aria-label="Stage"
			value={stage}
			onchange={(e: Event) => {
				stage = (e.currentTarget as HTMLSelectElement).value as typeof stage;
				page = 1;
			}}
		>
			<option value="">All reports</option>
			{#each stages as s (s.value)}
				<option value={s.value}>{s.label}</option>
			{/each}
		</Select>
	</FilterBar>

	<DataList {result} empty="No equipment reports" onpage={(p) => (page = p)}>
		{#snippet children(reports)}
			<TriageTable
				subjectLabel="Unit or place"
				rows={reports.map((r) => ({
					id: r.id,
					href: resolve(`/staff/flags/equipment/${r.id}`),
					// Sent to a work order is still `pending` in the table; say what it means.
					status: r.stage === 'in_work_order' ? 'in_progress' : r.status,
					kind: r.blocksUse ? 'Out of use' : r.asset ? entityLabels.asset.one : 'Building',
					subject: r.asset ?? r.location ?? 'Building',
					text: r.note,
					reporter: r.reportedByName ?? 'Deleted account',
					createdAt: r.createdAt
				}))}
			/>
		{/snippet}
	</DataList>
</PageContent>
