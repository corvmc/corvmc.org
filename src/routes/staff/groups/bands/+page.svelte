<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import SearchInput from '#lib/components/ui/Form/SearchInput.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import DataList from '#lib/components/ui/DataList.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import FilterBar from '#lib/components/ui/FilterBar.svelte';
	import Select from '#lib/components/ui/Form/Select.svelte';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import { EntityChip, EntityIdentity } from '#lib/components/ui/entity/index.js';
	import { rowLink } from '#lib/actions/row-link.js';
	import { resolve } from '$app/paths';
	import Button from '#lib/components/ui/Button.svelte';
	import { CreateBandAction } from '#lib/components/actions/index.js';
	import { getStaffBands, getStaffBandTotals } from '#lib/remote/bands.remote.js';
	import { rosterState } from '#lib/components/roster/roster-state.svelte.js';
	import { oneOf } from '#lib/urlState.svelte.js';
	import { formatDateShortYear } from '#lib/utils/format.js';
	import Alert from '#lib/components/ui/Alert.svelte';
	import { retryQuery } from '#lib/utils/retry-query.js';
	import BandTotals from './BandTotals.svelte';
	import GroupViews from '../GroupViews.svelte';
	import GroupRecordPanel from '../[id]/GroupRecordPanel.svelte';

	// Deactivated bands are hidden until the filter asks for them.
	const view = rosterState(resolve('staff/groups/bands'), {
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

<PageHeader title={m.staff_groups_title()}>
	<GroupViews active="bands" />
</PageHeader>
<PageContent>
	<svelte:boundary>
		<BandTotals />
		{#snippet failed(_error, reset)}
			<Alert type="warning" reset={() => retryQuery(getStaffBandTotals(), reset)}>
				{m.staff_totals_didn_t_load_body()}
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
				placeholder={m.staff_search_by_name_placeholder()}
				onsearch={(q) => {
					f.q = q;
					f.page = 1;
				}}
			/>
		{/snippet}
		{#snippet menu()}
			<label class="flex flex-col gap-1">
				<span class="text-muted text-xs">{m.staff_status_label()}</span>
				<Select
					size="sm"
					value={f.status}
					onchange={(e: Event) => {
						f.status = (e.currentTarget as HTMLSelectElement).value as typeof f.status;
						f.page = 1;
					}}
				>
					<option value="active">{m.staff_active_label()}</option>
					<option value="deactivated">{m.staff_deactivated_label()}</option>
					<option value="all">{m.staff_all_statuses_label()}</option>
				</Select>
			</label>
			<label class="flex flex-col gap-1">
				<span class="text-muted text-xs">{m.staff_tier_label()}</span>
				<Select
					size="sm"
					value={f.tier}
					onchange={(e: Event) => {
						f.tier = (e.currentTarget as HTMLSelectElement).value as typeof f.tier;
						f.page = 1;
					}}
				>
					<option value="">{m.staff_groups_all_tiers_label()}</option>
					<option value="free">{m.staff_groups_free_label()}</option>
					<option value="premium">{m.staff_premium_label()}</option>
				</Select>
			</label>
		{/snippet}
		{#snippet actions()}
			<!-- External acts stay beside bands: the same staff job, and one can become the other. -->
			<Button variant="ghost" size="sm" href={resolve('staff/bands/acts')}
				>{m.staff_external_acts_label()}</Button
			>
			<CreateBandAction />
		{/snippet}
	</FilterBar>

	<DataList {result} empty={m.staff_groups_empty_body()} onpage={(p) => (f.page = p)}>
		{#snippet children(bands)}
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">{m.staff_status_label()}</span></th>
					<th>{m.staff_band_label()}</th>
					<th>{m.staff_owner_label()}</th>
					<th class="col-support">{m.staff_tier_label()}</th>
					<th class="col-support cell-num">{m.staff_members_label()}</th>
					<th class="col-extra whitespace-nowrap">{m.staff_created_label()}</th>
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
