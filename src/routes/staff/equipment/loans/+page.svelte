<script lang="ts">
	import SearchInput from '$lib/components/shared/Form/SearchInput.svelte';
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import DataList from '$lib/components/shared/DataList.svelte';
	import Table from '$lib/components/shared/Table.svelte';
	import FilterBar from '$lib/components/shared/FilterBar.svelte';
	import Select from '$lib/components/shared/Form/Select.svelte';
	import StatusBadge from '$lib/components/shared/StatusBadge.svelte';
	import { EntityChip, EntityIdentity } from '$lib/components/shared/entity';
	import Badge from '$lib/components/shared/Badge.svelte';
	import { rowLink } from '$lib/actions/row-link';
	import { resolve } from '$app/paths';
	import { formatDateShort, formatCents, titleCase } from '$lib/utils/format';
	import { loanStatuses } from '$lib/config';
	import { CreateLoanAction } from '$lib/components/shared/actions';
	import { getStaffLoans } from '$lib/remote/equipment.remote';

	// `searchText`, not `search`: FilterBar's always-visible slot is a snippet
	// named `search`, and a snippet shadows a same-named script binding.
	let searchText = $state('');
	let statusFilter = $state('');
	let page = $state(1);

	let searchDebounced = $state('');
	let filters = $derived({
		search: searchDebounced || undefined,
		status: statusFilter || undefined,
		page
	});

	let result = $derived(getStaffLoans(filters));

	const activeFilterCount = $derived((searchDebounced ? 1 : 0) + (statusFilter ? 1 : 0));

	function clearFilters() {
		searchText = '';
		searchDebounced = '';
		statusFilter = '';
		page = 1;
	}
</script>

<PageHeader title="Equipment Loans" backHref="/staff/equipment">
	<CreateLoanAction />
</PageHeader>
<PageContent>
	<FilterBar activeCount={activeFilterCount} onclear={clearFilters}>
		{#snippet search()}
			<SearchInput
				bind:value={searchText}
				placeholder="Search by member..."
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
				statusFilter = (e.currentTarget as HTMLSelectElement).value;
				page = 1;
			}}
		>
			<option value="">All statuses</option>
			{#each loanStatuses as s (s)}
				<option value={s}>{titleCase(s)}</option>
			{/each}
		</Select>
	</FilterBar>

	<DataList {result} empty="No loans found" onpage={(p) => (page = p)}>
		{#snippet children(loans)}
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">Status</span></th>
					<th>Loan</th>
					<th>Member</th>
					<th class="col-support whitespace-nowrap">Due</th>
					<th class="col-extra whitespace-nowrap">Requested</th>
					<th class="col-support cell-num">Charge</th>
				{/snippet}

				{#each loans as l (l.id)}
					{@const href = resolve(`/staff/equipment/loans/${l.id}`)}
					<tr class="hover cursor-pointer" use:rowLink={href}>
						<td class="w-px">
							<div class="flex items-center gap-1">
								<StatusBadge status={l.status} />
								{#if l.isOverdue}
									<Badge variant="error" size="xs">Overdue</Badge>
								{/if}
							</div>
						</td>
						<!-- Equipment is what was borrowed; the borrower is a record of its
						     own, so it gets a column rather than riding this cell's subline. -->
						<td class="cell-primary"><EntityIdentity ref={l.ref} /></td>
						<td class="min-w-0"><EntityChip ref={l.member} icon={false} /></td>
						<td class="col-support whitespace-nowrap">
							{l.dueDate ? formatDateShort(l.dueDate) : '—'}
						</td>
						<td class="col-extra whitespace-nowrap">
							{formatDateShort(l.requestedPickupDate)}
						</td>
						<td class="col-support cell-num">
							{l.totalChargeCents != null ? formatCents(l.totalChargeCents) : '—'}
						</td>
					</tr>
				{/each}
			</Table>
		{/snippet}
	</DataList>
</PageContent>
