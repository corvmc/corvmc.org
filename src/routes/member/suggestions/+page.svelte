<script lang="ts">
	import SearchInput from '$lib/components/shared/Form/SearchInput.svelte';
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import DataList from '$lib/components/shared/DataList.svelte';
	import FilterBar from '$lib/components/shared/FilterBar.svelte';
	import Select from '$lib/components/shared/Form/Select.svelte';
	import {
		suggestionCategories,
		suggestionStatuses,
		suggestionCategoryLabels,
		suggestionStatusLabels
	} from '$lib/config';
	import { getSuggestionBoard } from '$lib/remote/suggestions.remote';
	import SuggestionCard from './SuggestionCard.svelte';
	import StandingNotice from './StandingNotice.svelte';
	import CreateSuggestionAction from './CreateSuggestionAction.svelte';

	// `searchText`, not `search`: FilterBar's always-visible slot is a snippet
	// named `search`, and a snippet shadows a same-named script binding.
	let searchText = $state('');
	let categoryFilter = $state('');
	let statusFilter = $state('');
	let sort = $state<'top' | 'new'>('top');
	let page = $state(1);

	let searchDebounced = $state('');
	let filters = $derived({
		search: searchDebounced || undefined,
		category: (categoryFilter || undefined) as (typeof suggestionCategories)[number] | undefined,
		status: (statusFilter || undefined) as (typeof suggestionStatuses)[number] | undefined,
		sort,
		page
	});

	let result = $derived(getSuggestionBoard(filters));

	const activeFilterCount = $derived(
		(searchDebounced ? 1 : 0) + (categoryFilter ? 1 : 0) + (statusFilter ? 1 : 0)
	);

	function clearFilters() {
		searchText = '';
		searchDebounced = '';
		categoryFilter = '';
		statusFilter = '';
		page = 1;
	}

	// The board's cache key is this exact filters object, so the refresh has to
	// happen here rather than inside the vote/flag handlers, which can't see it.
	function refreshBoard() {
		void getSuggestionBoard(filters).refresh();
	}
</script>

<PageHeader title="Suggestions" subtitle="Member">
	<CreateSuggestionAction />
</PageHeader>

<PageContent>
	<StandingNotice />

	<FilterBar activeCount={activeFilterCount} onclear={clearFilters}>
		{#snippet search()}
			<SearchInput
				bind:value={searchText}
				placeholder="Search suggestions..."
				onsearch={(q) => {
					searchDebounced = q;
					page = 1;
				}}
			/>
		{/snippet}
		<Select
			size="sm"
			aria-label="Category"
			value={categoryFilter}
			onchange={(e: Event) => {
				categoryFilter = (e.currentTarget as HTMLSelectElement).value;
				page = 1;
			}}
		>
			<option value="">All categories</option>
			{#each suggestionCategories as c (c)}
				<option value={c}>{suggestionCategoryLabels[c]}</option>
			{/each}
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
			<option value="">Any status</option>
			{#each suggestionStatuses as s (s)}
				<option value={s}>{suggestionStatusLabels[s]}</option>
			{/each}
		</Select>
		<Select
			size="sm"
			aria-label="Sort"
			value={sort}
			onchange={(e: Event) => {
				sort = (e.currentTarget as HTMLSelectElement).value as 'top' | 'new';
				page = 1;
			}}
		>
			<option value="top">Most votes</option>
			<option value="new">Newest</option>
		</Select>
	</FilterBar>

	<DataList
		{result}
		emptyTitle="No suggestions yet"
		empty="Be the first to say what the collective should do next."
		onpage={(p) => (page = p)}
	>
		{#snippet children(rows)}
			<ul class="space-y-2">
				{#each rows as s (s.id)}
					<SuggestionCard suggestion={s} isMine={s.isMine} onchanged={refreshBoard} />
				{/each}
			</ul>
		{/snippet}
	</DataList>
</PageContent>
