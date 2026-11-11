<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import SearchInput from '#lib/components/ui/Form/SearchInput.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import DataList from '#lib/components/ui/DataList.svelte';
	import FilterBar from '#lib/components/ui/FilterBar.svelte';
	import Select from '#lib/components/ui/Form/Select.svelte';
	import { entityLabels } from '#lib/terms.js';
	import { resolve } from '$app/paths';
	import { getEquipmentReportQueue } from '#lib/remote/work-requests.remote.js';
	import TriageTable from '#lib/components/ui/TriageTable.svelte';

	const stages = [
		{ value: 'untriaged', label: m.staff_inventory_problems_needs_triage_label() },
		{ value: 'in_work_order', label: m.staff_inventory_problems_work_order_label() },
		{ value: 'resolved', label: m.staff_inventory_problems_resolved_label() },
		{ value: 'dismissed', label: m.staff_inventory_problems_dismissed_label() }
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

<PageHeader title={m.staff_inventory_problems_title()} />
<PageContent>
	<FilterBar activeCount={activeFilterCount} onclear={clearFilters}>
		{#snippet search()}
			<SearchInput
				bind:value={searchText}
				placeholder={m.staff_inventory_problems_placeholder()}
				onsearch={(q) => {
					searchDebounced = q;
					page = 1;
				}}
			/>
		{/snippet}
		<Select
			size="sm"
			aria-label={m.staff_inventory_problems_aria_label()}
			value={stage}
			onchange={(e: Event) => {
				stage = (e.currentTarget as HTMLSelectElement).value as typeof stage;
				page = 1;
			}}
		>
			<option value="">{m.staff_inventory_problems_all_reports_label()}</option>
			{#each stages as s (s.value)}
				<option value={s.value}>{s.label}</option>
			{/each}
		</Select>
	</FilterBar>

	<DataList {result} empty={m.staff_inventory_problems_empty_body()} onpage={(p) => (page = p)}>
		{#snippet children(reports)}
			<TriageTable
				subjectLabel={m.staff_inventory_problems_subject_label()}
				rows={reports.map((r) => ({
					id: r.id,
					href: resolve(`staff/inventory/problems/${r.id}`),
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
