<script lang="ts">
	import SearchInput from '$lib/components/shared/Form/SearchInput.svelte';
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import DataList from '$lib/components/shared/DataList.svelte';
	import FilterBar from '$lib/components/shared/FilterBar.svelte';
	import Table from '$lib/components/shared/Table.svelte';
	import TabBar from '$lib/components/shared/TabBar.svelte';
	import Select from '$lib/components/shared/Form/Select.svelte';
	import StatusBadge from '$lib/components/shared/StatusBadge.svelte';
	import { EntityChip, EntityIdentity } from '$lib/components/shared/entity';
	import Badge from '$lib/components/shared/Badge.svelte';
	import { rowLink } from '$lib/actions/row-link';
	import { resolve } from '$app/paths';
	import { relativeDay } from '$lib/utils/format';
	import {
		suggestionCategories,
		suggestionStatuses,
		suggestionCategoryLabels,
		suggestionStatusLabels
	} from '$lib/config';
	import { getSuggestionsQueue, getPendingSuggestionEdits } from '$lib/remote/suggestions.remote';

	// One tab per reason a suggestion is or isn't on the board. "Needs review" is
	// the time-sensitive one: everything in it is invisible to members until
	// somebody acts.
	type TabKey = 'board' | 'review' | 'hidden';
	let tab = $state<TabKey>('board');

	let searchText = $state('');
	let categoryFilter = $state('');
	let statusFilter = $state('');
	let page = $state(1);

	let searchDebounced = $state('');
	// `pending_review` and `under_review` are two different reasons for the same
	// member-visible fact, so the review tab runs them as two queries and shows
	// them together rather than pretending they're one state.
	let baseFilters = $derived({
		search: searchDebounced || undefined,
		category: (categoryFilter || undefined) as (typeof suggestionCategories)[number] | undefined,
		status: (statusFilter || undefined) as (typeof suggestionStatuses)[number] | undefined,
		sort: 'top' as const,
		page
	});

	let boardFilters = $derived({ ...baseFilters, visibility: 'visible' as const });
	let pendingFilters = $derived({ ...baseFilters, visibility: 'pending_review' as const });
	let underReviewFilters = $derived({ ...baseFilters, visibility: 'under_review' as const });
	let hiddenFilters = $derived({ ...baseFilters, visibility: 'hidden' as const });

	let result = $derived(
		tab === 'board'
			? getSuggestionsQueue(boardFilters)
			: tab === 'hidden'
				? getSuggestionsQueue(hiddenFilters)
				: getSuggestionsQueue(pendingFilters)
	);
	// The second half of the review tab. Kept separate so its pagination and the
	// pending one don't fight over a single `page`.
	let underReview = $derived(getSuggestionsQueue(underReviewFilters));
	let pendingEdits = $derived(await getPendingSuggestionEdits());

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

	const tabs = $derived([
		{ key: 'board', label: 'Board' },
		{ key: 'review', label: 'Needs review' },
		{ key: 'hidden', label: 'Hidden' }
	]);
</script>

<PageHeader title="Suggestions" subtitle="Staff" />

<PageContent width="full">
	<TabBar
		{tabs}
		active={tab}
		onchange={(k) => {
			tab = k as TabKey;
			page = 1;
		}}
	/>

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
	</FilterBar>

	{#if tab === 'review'}
		<p class="text-muted">
			Nothing here is visible to members. Reported suggestions are resolved in
			<a class="link" href={resolve('/staff/flags')}>Content Flags</a>, not here.
		</p>
	{/if}

	<DataList
		{result}
		empty={tab === 'review' ? 'Nothing waiting on you' : 'No suggestions found'}
		onpage={(p) => (page = p)}
	>
		{#snippet children(rows)}
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">Status</span></th>
					<th>Suggestion</th>
					<th>Author</th>
					<th class="col-support w-px">Category</th>
					<th class="col-support w-px cell-num">Votes</th>
					<th class="col-extra whitespace-nowrap">Posted</th>
				{/snippet}
				{#each rows as s (s.id)}
					{@const href = resolve(`/staff/suggestions/${s.id}`)}
					<tr class="hover cursor-pointer" use:rowLink={href}>
						<td class="w-px">
							<StatusBadge status={s.mergedIntoId ? 'merged' : s.status} />
						</td>
						<td class="cell-primary"><EntityIdentity ref={s.ref} /></td>
						<td class="min-w-0"><EntityChip ref={s.author} icon={false} /></td>
						<td class="col-support w-px whitespace-nowrap">
							<Badge size="xs" variant="ghost">
								{suggestionCategoryLabels[s.category as keyof typeof suggestionCategoryLabels] ??
									s.category}
							</Badge>
						</td>
						<td class="col-support w-px cell-num">{s.voteCount}</td>
						<td class="col-extra whitespace-nowrap">{relativeDay(s.createdAt)}</td>
					</tr>
				{/each}
			</Table>
		{/snippet}
	</DataList>

	{#if tab === 'review' && pendingEdits.length > 0}
		<h2 class="text-muted font-medium">Edits waiting on approval</h2>
		<!-- These sit apart from the two lists above: the suggestion itself is
		     still on the board and untouched, it's only the proposed change that
		     is waiting. -->
		<Table>
			{#snippet head()}
				<th class="w-px"><span class="sr-only">Status</span></th>
				<th>Proposed change</th>
				<th>Requested by</th>
				<th class="col-extra whitespace-nowrap">Requested</th>
			{/snippet}
			{#each pendingEdits as e (e.id)}
				{@const href = resolve(`/staff/suggestions/${e.suggestionId}`)}
				<tr class="hover cursor-pointer" use:rowLink={href}>
					<td class="w-px"><StatusBadge status="pending_review" /></td>
					<td class="cell-primary">
						<EntityIdentity ref={e.ref}>
							{#snippet subtitle()}was "{e.originalTitle}"{/snippet}
						</EntityIdentity>
					</td>
					<td class="min-w-0"><EntityChip ref={e.requestedBy} icon={false} /></td>
					<td class="col-extra whitespace-nowrap">{relativeDay(e.createdAt)}</td>
				</tr>
			{/each}
		</Table>
	{/if}

	{#if tab === 'review'}
		<h2 class="text-muted font-medium">Reported and pulled from the board</h2>
		<DataList result={underReview} empty="No reported suggestions">
			{#snippet children(rows)}
				<Table>
					{#snippet head()}
						<th class="w-px"><span class="sr-only">Status</span></th>
						<th>Suggestion</th>
						<th>Author</th>
						<th class="col-support w-px cell-num">Votes</th>
						<th class="col-extra whitespace-nowrap">Posted</th>
					{/snippet}
					{#each rows as s (s.id)}
						{@const href = resolve(`/staff/suggestions/${s.id}`)}
						<tr class="hover cursor-pointer" use:rowLink={href}>
							<td class="w-px"><StatusBadge status="under_review" /></td>
							<td class="cell-primary"><EntityIdentity ref={s.ref} /></td>
							<td class="min-w-0"><EntityChip ref={s.author} icon={false} /></td>
							<td class="col-support w-px cell-num">{s.voteCount}</td>
							<td class="col-extra whitespace-nowrap">{relativeDay(s.createdAt)}</td>
						</tr>
					{/each}
				</Table>
			{/snippet}
		</DataList>
	{/if}
</PageContent>
