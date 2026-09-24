<script lang="ts">
	import { resolve } from '$app/paths';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import DataList from '$lib/components/ui/DataList.svelte';
	import FilterBar from '$lib/components/ui/FilterBar.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import TabBar from '$lib/components/ui/TabBar.svelte';
	import SearchInput from '$lib/components/ui/Form/SearchInput.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import { EntityChip, EntityIdentity } from '$lib/components/ui/entity';
	import { rowLink } from '$lib/actions/row-link';
	import { relativeDay } from '$lib/utils/format';
	import {
		classifiedKindLabels,
		classifiedCategoryLabels,
		classifiedVisibilityLabels,
		type ClassifiedVisibility
	} from '$lib/config';
	import { getStaffClassifieds } from '$lib/remote/classifieds.remote';

	// Opens on what is waiting for staff: nothing in it is visible to members.
	let tab = $state<ClassifiedVisibility>('pending_review');
	let searchText = $state('');
	let searchDebounced = $state('');
	let page = $state(1);

	const result = $derived(
		getStaffClassifieds({ visibility: tab, search: searchDebounced || undefined, page })
	);

	const tabs = (['pending_review', 'under_review', 'visible', 'hidden'] as const).map((key) => ({
		key,
		label: classifiedVisibilityLabels[key]
	}));
</script>

<PageHeader title="Classifieds" subtitle="Staff" />

<PageContent>
	<TabBar
		{tabs}
		active={tab}
		onchange={(k) => {
			tab = k as ClassifiedVisibility;
			page = 1;
		}}
	/>

	<FilterBar
		activeCount={searchDebounced ? 1 : 0}
		onclear={() => {
			searchText = '';
			searchDebounced = '';
			page = 1;
		}}
	>
		{#snippet search()}
			<SearchInput
				bind:value={searchText}
				placeholder="Search posts..."
				onsearch={(q) => {
					searchDebounced = q;
					page = 1;
				}}
			/>
		{/snippet}
	</FilterBar>

	{#if tab === 'under_review'}
		<p class="text-muted">
			Reported posts are decided in
			<a class="link" href={resolve('/staff/flags')}>Content Flags</a>.
		</p>
	{/if}

	<DataList {result} empty="No posts here" onpage={(p) => (page = p)}>
		{#snippet children(rows)}
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">Status</span></th>
					<th>Post</th>
					<th>Posted by</th>
					<th class="col-extra whitespace-nowrap">Posted</th>
				{/snippet}
				{#each rows as r (r.id)}
					<tr class="hover cursor-pointer" use:rowLink={resolve(`/staff/classifieds/${r.id}`)}>
						<td class="w-px"><StatusBadge status={r.displayStatus} /></td>
						<td class="cell-primary">
							<EntityIdentity ref={r.ref}>
								{#snippet subtitle()}
									{classifiedKindLabels[r.kind]} · {classifiedCategoryLabels[r.category]}
								{/snippet}
							</EntityIdentity>
						</td>
						<td class="min-w-0"><EntityChip ref={r.author} icon={false} /></td>
						<td class="col-extra whitespace-nowrap">{relativeDay(r.createdAt)}</td>
					</tr>
				{/each}
			</Table>
		{/snippet}
	</DataList>
</PageContent>
