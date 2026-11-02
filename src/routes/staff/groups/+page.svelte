<script lang="ts">
	import SearchInput from '$lib/components/ui/Form/SearchInput.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import DataList from '$lib/components/ui/DataList.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import FilterBar from '$lib/components/ui/FilterBar.svelte';
	import Select from '$lib/components/ui/Form/Select.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import { EntityChip, EntityIdentity } from '$lib/components/ui/entity';
	import { rowLink } from '$lib/actions/row-link';
	import { resolve } from '$app/paths';
	import Button from '$lib/components/ui/Button.svelte';
	import { CreateBandAction } from '$lib/components/actions';
	import { getStaffBands, getStaffBandTotals } from '$lib/remote/bands.remote';
	import { rosterState } from '$lib/components/roster/roster-state.svelte';
	import { oneOf } from '$lib/urlState.svelte';
	import { formatDateShortYear } from '$lib/utils/format';
	import Alert from '$lib/components/ui/Alert.svelte';
	import { retryQuery } from '$lib/utils/retry-query';
	import BandTotals from './BandTotals.svelte';
	import GroupViews from './GroupViews.svelte';
	import GroupRecordPanel from './[id]/GroupRecordPanel.svelte';

	// Deactivated bands are hidden until the filter asks for them.
	const view = rosterState(resolve('/staff/groups'), {
		status: oneOf(['active', 'deactivated', 'all'] as const, 'active'),
		tier: oneOf(['', 'free', 'premium'] as const, '')
	});
	const f = view.values;
	// `searchText`, not `search`: FilterBar's `search` snippet would shadow it.
	let searchText = $state(f.q);

	const result = $derived(
		getStaffBands({
			search: f.q || undefined,
			status: f.status === 'all' ? undefined : f.status,
			tier: f.tier || undefined,
			page: f.page
		})
	);

	const menuFilterCount = $derived((f.status === 'active' ? 0 : 1) + (f.tier ? 1 : 0));

	let selected = $state<{ id: string; name: string } | null>(null);
	let panelOpen = $state(false);
	function openPanel(id: string, name: string) {
		selected = { id, name };
		panelOpen = true;
	}
</script>

<PageHeader title="Groups">
	<!-- External acts stay beside bands: the same staff job, and one can become the other. -->
	<Button variant="ghost" href={resolve('/staff/bands/acts')}>External acts</Button>
	<CreateBandAction />
</PageHeader>
<PageContent>
	<GroupViews active="bands" />
	<svelte:boundary>
		<BandTotals />
		{#snippet failed(_error, reset)}
			<Alert type="warning" reset={() => retryQuery(getStaffBandTotals(), reset)}>
				The totals didn't load.
			</Alert>
		{/snippet}
	</svelte:boundary>

	<FilterBar
		activeCount={view.activeCount}
		menuCount={menuFilterCount}
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
		{#snippet menu()}
			<label class="flex flex-col gap-1">
				<span class="text-muted text-xs">Status</span>
				<Select
					size="sm"
					value={f.status}
					onchange={(e: Event) => {
						f.status = (e.currentTarget as HTMLSelectElement).value as typeof f.status;
						f.page = 1;
					}}
				>
					<option value="active">Active</option>
					<option value="deactivated">Deactivated</option>
					<option value="all">All statuses</option>
				</Select>
			</label>
			<label class="flex flex-col gap-1">
				<span class="text-muted text-xs">Tier</span>
				<Select
					size="sm"
					value={f.tier}
					onchange={(e: Event) => {
						f.tier = (e.currentTarget as HTMLSelectElement).value as typeof f.tier;
						f.page = 1;
					}}
				>
					<option value="">All tiers</option>
					<option value="free">Free</option>
					<option value="premium">Premium</option>
				</Select>
			</label>
		{/snippet}
	</FilterBar>

	<DataList {result} empty="No bands found" onpage={(p) => (f.page = p)}>
		{#snippet children(bands)}
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">Status</span></th>
					<th>Band</th>
					<th>Owner</th>
					<th class="col-support">Tier</th>
					<th class="col-support cell-num">Members</th>
					<th class="col-extra whitespace-nowrap">Created</th>
				{/snippet}

				{#each bands as b (b.id)}
					<tr class="hover cursor-pointer" use:rowLink={() => openPanel(b.id, b.ref.title)}>
						<td class="w-px">
							<StatusBadge status={b.deletedAt ? 'deactivated' : 'active'} />
						</td>
						<td class="cell-primary">
							<!-- The keyboard path to the panel, which a row cannot be. -->
							<button
								type="button"
								class="block w-full min-w-0 text-left"
								onclick={() => openPanel(b.id, b.ref.title)}
							>
								<EntityIdentity ref={b.ref} link={false} />
							</button>
						</td>
						<!-- The owner is a member, not a fact about the band, so it takes a
						     column and reaches their record. -->
						<td class="min-w-0"><EntityChip ref={b.owner} icon={false} /></td>
						<td class="col-support"><StatusBadge status={b.tier} label /></td>
						<td class="col-support cell-num">{b.memberCount}</td>
						<td class="col-extra whitespace-nowrap">{formatDateShortYear(b.createdAt)}</td>
					</tr>
				{/each}
			</Table>
		{/snippet}
	</DataList>
</PageContent>

{#if selected}
	{#key selected.id}
		<GroupRecordPanel kind="band" id={selected.id} name={selected.name} bind:open={panelOpen} />
	{/key}
{/if}
