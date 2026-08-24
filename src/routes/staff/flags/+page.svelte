<script lang="ts">
	import SearchInput from '$lib/components/shared/Form/SearchInput.svelte';
	import CardBody from '$lib/components/shared/Card/CardBody.svelte';
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import DataList from '$lib/components/shared/DataList.svelte';
	import FilterBar from '$lib/components/shared/FilterBar.svelte';
	import Select from '$lib/components/shared/Form/Select.svelte';
	import StatusBadge from '$lib/components/shared/StatusBadge.svelte';
	import { EntityIdentity } from '$lib/components/shared/entity';
	import { entityLabels } from '$lib/config';
	import Badge from '$lib/components/shared/Badge.svelte';
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
		Cards, not a table: the reason is unbounded prose, and a report only makes
		sense read as a whole. Truncating it to a column width is what made this
		queue unusable — you had to open every row to know what was reported.
	-->
	<DataList {result} empty="No flags found" onpage={(p) => (page = p)}>
		{#snippet children(flags)}
			<ul class="space-y-2">
				{#each flags as f (f.id)}
					<li class="card bg-base-100 shadow">
						<CardBody padding="sm" class="gap-2">
							<!-- No `flex-wrap`, and the title truncates: wrapping this row pushed
							     the status badge and the timestamp onto ragged extra lines. -->
							<div class="flex min-w-0 items-center gap-2">
								<Badge size="sm" variant="outline" class="shrink-0">
									{entityLabels[f.target.type].one}
								</Badge>
								<EntityIdentity ref={f.ref} class="min-w-0" />
								<span class="shrink-0"><StatusBadge status={f.status} label /></span>
							</div>
							<p class="text-sm">{f.reason}</p>
							<p class="text-muted">
								Reported by {f.reportedByName ?? 'Anonymous visitor'} · {relativeDay(f.createdAt)}
							</p>
						</CardBody>
					</li>
				{/each}
			</ul>
		{/snippet}
	</DataList>
</PageContent>
