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
	import { CreateBandAction } from '$lib/components/actions';
	import { getStaffBands } from '$lib/remote/bands.remote';
	import { formatDateShortYear } from '$lib/utils/format';

	// `searchText`, not `search`: FilterBar's always-visible slot is a snippet
	// named `search`, and a snippet shadows a same-named script binding.
	let searchText = $state('');
	let status = $state<'active' | 'deactivated' | ''>('');
	let tier = $state<'free' | 'premium' | ''>('');
	let page = $state(1);

	let searchDebounced = $state('');
	let filters = $derived({
		search: searchDebounced || undefined,
		status: status || undefined,
		tier: tier || undefined,
		page
	});

	let result = $derived(getStaffBands(filters));

	const activeFilterCount = $derived((searchDebounced ? 1 : 0) + (status ? 1 : 0) + (tier ? 1 : 0));

	function clearFilters() {
		searchText = '';
		searchDebounced = '';
		status = '';
		tier = '';
		page = 1;
	}
</script>

<PageHeader title="Bands">
	<!-- External acts live beside bands rather than under their own nav entry:
	     they are the same staff job (who is playing here) and one of them can
	     turn into the other. -->
	<a class="btn btn-ghost btn-sm" href={resolve('/staff/bands/acts')}>External acts</a>
	<CreateBandAction />
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
		<Select
			size="sm"
			aria-label="Tier"
			value={tier}
			onchange={(e: Event) => {
				tier = (e.currentTarget as HTMLSelectElement).value as typeof tier;
				page = 1;
			}}
		>
			<option value="">All tiers</option>
			<option value="free">Free</option>
			<option value="premium">Premium</option>
		</Select>
	</FilterBar>

	<DataList {result} empty="No bands found" onpage={(p) => (page = p)}>
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
					{@const href = resolve(`/staff/bands/${b.id}`)}
					<tr class="hover cursor-pointer" use:rowLink={href}>
						<td class="w-px">
							<StatusBadge status={b.deletedAt ? 'deactivated' : 'active'} />
						</td>
						<td class="cell-primary"><EntityIdentity ref={b.ref} /></td>
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
