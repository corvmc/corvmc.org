<script lang="ts">
	import SearchInput from '$lib/components/ui/Form/SearchInput.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import DataList from '$lib/components/ui/DataList.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import FilterBar from '$lib/components/ui/FilterBar.svelte';
	import Select from '$lib/components/ui/Form/Select.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import { EntityChip } from '$lib/components/ui/entity';
	import Badge from '$lib/components/ui/Badge.svelte';
	import { rowLink } from '$lib/actions/row-link';
	import { resolve } from '$app/paths';
	import CreateGroupAction from '$lib/components/groups/CreateGroupAction.svelte';
	import { getStaffGroups, getStaffClubTotals } from '$lib/remote/groups.remote';
	import { formatDateShortYear } from '$lib/utils/format';
	import Alert from '$lib/components/ui/Alert.svelte';
	import { retryQuery } from '$lib/utils/retry-query';
	import ClubTotals from './ClubTotals.svelte';

	/**
	 * Clubs. Committees have their own list at `/staff/committees`, and bands are
	 * a member's own project with their own surface at `/staff/bands`. A club is
	 * the opposite of a band: staff created it and staff appoint its chairs.
	 */

	// `searchText`, not `search`: FilterBar's always-visible slot is a snippet
	// named `search`, and a snippet shadows a same-named script binding.
	let searchText = $state('');
	// Active by default, so the table shows the clubs the counts above count.
	let status = $state<'active' | 'deactivated' | ''>('active');
	let page = $state(1);

	let searchDebounced = $state('');
	let filters = $derived({
		search: searchDebounced || undefined,
		status: status || undefined,
		kind: 'club' as const,
		page
	});

	let result = $derived(getStaffGroups(filters));

	// Chairs past this collapse into a `+N`, as BadgeList does: one crowded club
	// must not set the height of every row beside it.
	const MAX_CHAIRS = 2;

	const activeFilterCount = $derived((searchDebounced ? 1 : 0) + (status === 'active' ? 0 : 1));

	function clearFilters() {
		searchText = '';
		searchDebounced = '';
		status = 'active';
		page = 1;
	}
</script>

<PageHeader title="Clubs">
	<CreateGroupAction />
</PageHeader>
<PageContent>
	<svelte:boundary>
		<ClubTotals />
		{#snippet failed(_error, reset)}
			<Alert type="warning" reset={() => retryQuery(getStaffClubTotals(), reset)}>
				The club totals didn't load. The table below is unaffected.
			</Alert>
		{/snippet}
	</svelte:boundary>

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
			aria-label="Status"
			value={status}
			onchange={(e: Event) => {
				status = (e.currentTarget as HTMLSelectElement).value as typeof status;
				page = 1;
			}}
		>
			<option value="active">Active</option>
			<option value="deactivated">Deactivated</option>
			<option value="">All statuses</option>
		</Select>
	</FilterBar>

	<DataList {result} empty="No clubs yet" onpage={(p) => (page = p)}>
		{#snippet children(groups)}
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">Status</span></th>
					<th>Club</th>
					<th>Chairs</th>
					<th class="col-support cell-num">Members</th>
					<th class="col-extra whitespace-nowrap">Created</th>
				{/snippet}

				{#each groups as g (g.id)}
					{@const href = resolve(`/staff/clubs/${g.id}`)}
					<tr class="hover cursor-pointer" use:rowLink={href}>
						<td class="w-px">
							<StatusBadge status={g.deletedAt ? 'deactivated' : 'active'} />
						</td>
						<!-- The name as text, not an `EntityIdentity`. A ref carries the
						     canonical page for its own type, and there is no group type —
						     handing it a band ref sent staff to `/staff/bands/{id}` for a
						     club. The row itself is the link. -->
						<td class="cell-primary">{g.name}</td>
						<!-- A club with no chairs is legal; it reads as a fact, not a fault. -->
						<td class="whitespace-nowrap">
							{#if g.chairs.length === 0}
								<span class="text-fg-2">No chairs</span>
							{:else}
								{@const hidden = g.chairs.slice(MAX_CHAIRS)}
								<span class="flex items-center gap-1">
									{#each g.chairs.slice(0, MAX_CHAIRS) as chair (chair.id)}
										<EntityChip ref={chair} icon={false} />
									{/each}
									{#if hidden.length > 0}
										<span class="inline-flex" title={hidden.map((c) => c.title).join(', ')}>
											<Badge variant="ghost" size="sm">+{hidden.length}</Badge>
										</span>
									{/if}
								</span>
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
