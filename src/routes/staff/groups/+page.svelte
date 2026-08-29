<script lang="ts">
	import SearchInput from '$lib/components/ui/Form/SearchInput.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import DataList from '$lib/components/ui/DataList.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import FilterBar from '$lib/components/ui/FilterBar.svelte';
	import Select from '$lib/components/ui/Form/Select.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import { EntityChip } from '$lib/components/ui/entity';
	import { rowLink } from '$lib/actions/row-link';
	import { resolve } from '$app/paths';
	import CreateGroupAction from './CreateGroupAction.svelte';
	import { getStaffGroups } from '$lib/remote/groups.remote';
	import { formatDateShortYear } from '$lib/utils/format';

	/**
	 * Clubs and committees. Bands are not here and never will be — they are a
	 * member's own project with their own staff surface at `/staff/bands`, and
	 * this page exists because a program is the opposite: staff created it and
	 * staff appointed whoever runs it.
	 */

	// `searchText`, not `search`: FilterBar's always-visible slot is a snippet
	// named `search`, and a snippet shadows a same-named script binding.
	let searchText = $state('');
	let status = $state<'active' | 'deactivated' | ''>('');
	let kind = $state<'club' | 'committee' | ''>('');
	let page = $state(1);

	let searchDebounced = $state('');
	let filters = $derived({
		search: searchDebounced || undefined,
		status: status || undefined,
		kind: kind || undefined,
		page
	});

	let result = $derived(getStaffGroups(filters));

	const activeFilterCount = $derived((searchDebounced ? 1 : 0) + (status ? 1 : 0) + (kind ? 1 : 0));

	function clearFilters() {
		searchText = '';
		searchDebounced = '';
		status = '';
		kind = '';
		page = 1;
	}
</script>

<PageHeader title="Groups" subtitle="Clubs and committees">
	<CreateGroupAction />
</PageHeader>
<PageContent>
	<FilterBar activeCount={activeFilterCount} onclear={clearFilters}>
		{#snippet search()}
			<SearchInput
				bind:value={searchText}
				placeholder="Search by name..."
				onsearch={(q) => {
					searchDebounced = q;
					page = 1;
				}}
			/>
		{/snippet}
		<Select
			size="sm"
			aria-label="Kind"
			value={kind}
			onchange={(e: Event) => {
				kind = (e.currentTarget as HTMLSelectElement).value as typeof kind;
				page = 1;
			}}
		>
			<option value="">All kinds</option>
			<option value="club">Clubs</option>
			<option value="committee">Committees</option>
		</Select>
		<Select
			size="sm"
			aria-label="Status"
			value={status}
			onchange={(e: Event) => {
				status = (e.currentTarget as HTMLSelectElement).value as typeof status;
				page = 1;
			}}
		>
			<option value="">All statuses</option>
			<option value="active">Active</option>
			<option value="deactivated">Deactivated</option>
		</Select>
	</FilterBar>

	<DataList {result} empty="No groups yet" onpage={(p) => (page = p)}>
		{#snippet children(groups)}
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">Status</span></th>
					<th>Group</th>
					<th class="col-support">Kind</th>
					<th>Leader</th>
					<th class="col-support cell-num">Members</th>
					<th class="col-extra whitespace-nowrap">Created</th>
				{/snippet}

				{#each groups as g (g.id)}
					{@const href = resolve(`/staff/groups/${g.id}`)}
					<tr class="hover cursor-pointer" use:rowLink={href}>
						<td class="w-px">
							<StatusBadge status={g.deletedAt ? 'deactivated' : 'active'} />
						</td>
						<!-- The name as text, not an `EntityIdentity`. A ref carries the
						     canonical page for its own type, and there is no group type —
						     handing it a band ref sent staff to `/staff/bands/{id}` for a
						     club. The row itself is the link. -->
						<td class="cell-primary">{g.name}</td>
						<td class="col-support"><Badge variant="ghost">{g.kind}</Badge></td>
						<!-- An empty seat is legal — a leader stepped down and nobody has
						     been appointed yet — and this list is where staff are meant to
						     see it, which is why the join is LEFT. -->
						<td class="min-w-0">
							{#if g.owner.id}
								<EntityChip ref={g.owner} icon={false} />
							{:else}
								<Badge variant="warning">No leader</Badge>
							{/if}
						</td>
						<td class="col-support cell-num">{g.memberCount}</td>
						<td class="col-extra whitespace-nowrap">{formatDateShortYear(g.createdAt)}</td>
					</tr>
				{/each}
			</Table>
		{/snippet}
	</DataList>
</PageContent>
