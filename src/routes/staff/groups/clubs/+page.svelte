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
	import { rosterState } from '$lib/components/roster/roster-state.svelte';
	import { oneOf } from '$lib/urlState.svelte';
	import CreateGroupAction from '$lib/components/groups/CreateGroupAction.svelte';
	import { getStaffGroups, getStaffClubTotals } from '$lib/remote/groups.remote';
	import { formatDateShortYear } from '$lib/utils/format';
	import Alert from '$lib/components/ui/Alert.svelte';
	import { retryQuery } from '$lib/utils/retry-query';
	import ClubTotals from './ClubTotals.svelte';
	import GroupViews from '../GroupViews.svelte';
	import GroupRecordPanel from '../[id]/GroupRecordPanel.svelte';

	// A club is the opposite of a band: staff create it and appoint its chairs.
	// Active by default, so the table shows the clubs the counts above count.
	const view = rosterState(resolve('/staff/groups/clubs'), {
		status: oneOf(['active', 'deactivated', ''] as const, 'active')
	});
	const f = view.values;
	// `searchText`, not `search`: FilterBar's `search` snippet would shadow it.
	let searchText = $state(f.q);

	const result = $derived(
		getStaffGroups({
			search: f.q || undefined,
			status: f.status || undefined,
			kind: 'club',
			page: f.page
		})
	);

	// Chairs past this collapse into a `+N`, as BadgeList does: one crowded club
	// must not set the height of every row beside it.
	const MAX_CHAIRS = 2;

	let selected = $state<{ id: string; name: string } | null>(null);
	let panelOpen = $state(false);
	function openPanel(id: string, name: string) {
		selected = { id, name };
		panelOpen = true;
	}
</script>

<PageHeader title="Groups">
	<CreateGroupAction />
</PageHeader>
<PageContent>
	<GroupViews active="clubs" />
	<svelte:boundary>
		<ClubTotals />
		{#snippet failed(_error, reset)}
			<Alert type="warning" reset={() => retryQuery(getStaffClubTotals(), reset)}>
				The totals didn't load.
			</Alert>
		{/snippet}
	</svelte:boundary>

	<FilterBar
		activeCount={view.activeCount}
		onclear={() => {
			searchText = '';
			view.clear();
		}}
	>
		{#snippet search()}
			<SearchInput
				bind:value={searchText}
				placeholder="Search by name..."
				onsearch={(q) => {
					f.q = q;
					f.page = 1;
				}}
			/>
		{/snippet}
		<Select
			size="sm"
			aria-label="Status"
			value={f.status}
			onchange={(e: Event) => {
				f.status = (e.currentTarget as HTMLSelectElement).value as typeof f.status;
				f.page = 1;
			}}
		>
			<option value="active">Active</option>
			<option value="deactivated">Deactivated</option>
			<option value="">All statuses</option>
		</Select>
	</FilterBar>

	<DataList {result} empty="No clubs yet" onpage={(p) => (f.page = p)}>
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
					<tr class="hover cursor-pointer" use:rowLink={() => openPanel(g.id, g.name)}>
						<td class="w-px">
							<StatusBadge status={g.deletedAt ? 'deactivated' : 'active'} />
						</td>
						<!-- The name, not an `EntityIdentity`: there is no group ref type, and
						     a band ref would link a club to the wrong record. -->
						<td class="cell-primary">
							<button
								type="button"
								class="block w-full truncate text-left"
								onclick={() => openPanel(g.id, g.name)}>{g.name}</button
							>
						</td>
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

{#if selected}
	{#key selected.id}
		<GroupRecordPanel kind="club" id={selected.id} name={selected.name} bind:open={panelOpen} />
	{/key}
{/if}
