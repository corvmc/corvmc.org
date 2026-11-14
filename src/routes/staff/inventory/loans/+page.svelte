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
	import Badge from '#lib/components/ui/Badge.svelte';
	import { rowLink } from '#lib/actions/row-link.js';
	import { resolve } from '$app/paths';
	import { formatDateShort, formatCents, titleCase } from '#lib/utils/format.js';
	import { loanStatuses } from '#lib/config.js';
	import { CheckOutKitAction, CreateLoanAction } from '#lib/components/actions/index.js';
	import KitLoanList from './KitLoanList.svelte';
	import { goto } from '$app/navigation';
	import { withQuery } from '#lib/utils/with-query.js';
	import { page as pageState } from '$app/state';
	import { getStaffLoans } from '#lib/remote/inventory.remote.js';
	import StaffViews from '../../StaffViews.svelte';
	import { gearViews } from '../views';

	// `searchText`, not `search`: FilterBar's always-visible slot is a snippet
	// named `search`, and a snippet shadows a same-named script binding.
	let searchText = $state('');
	let statusFilter = $state('');
	let page = $state(1);

	// Kits are a filter in the URL, not a tab: a kit loan is a loan of a room's kit.
	const kind = $derived(pageState.url.searchParams.get('kind') === 'kits' ? 'kits' : '');
	function setKind(next: string) {
		goto(withQuery(resolve('staff/inventory/loans'), next ? `?kind=${next}` : ''), {
			keepFocus: true,
			noScroll: true
		});
	}

	let searchDebounced = $state('');
	let filters = $derived({
		search: searchDebounced || undefined,
		status: statusFilter || undefined,
		page
	});

	let result = $derived(getStaffLoans(filters));

	const activeFilterCount = $derived(
		(searchDebounced ? 1 : 0) + (statusFilter ? 1 : 0) + (kind ? 1 : 0)
	);

	function clearFilters() {
		if (kind) setKind('');
		searchText = '';
		searchDebounced = '';
		statusFilter = '';
		page = 1;
	}
</script>

<PageHeader title={m.staff_gear_title()} documentTitle={m.staff_gear_loans_title()}>
	<StaffViews views={gearViews} active="loans" />
</PageHeader>
<PageContent>
	<FilterBar activeCount={activeFilterCount} onclear={clearFilters}>
		{#snippet search()}
			<SearchInput
				bind:value={searchText}
				placeholder={m.staff_inventory_loans_placeholder()}
				onsearch={(q) => {
					searchDebounced = q;
					page = 1;
				}}
			/>
		{/snippet}
		{#snippet actions()}
			<CheckOutKitAction />
			<CreateLoanAction />
		{/snippet}
		<Select
			size="sm"
			aria-label={m.staff_kind_label()}
			value={kind}
			onchange={(e: Event) => setKind((e.currentTarget as HTMLSelectElement).value)}
		>
			<option value="">{m.staff_items_label()}</option>
			<option value="kits">{m.staff_inventory_loans_kits_label()}</option>
		</Select>
		{#if !kind}
			<Select
				size="sm"
				aria-label={m.staff_status_label()}
				value={statusFilter}
				onchange={(e: Event) => {
					statusFilter = (e.currentTarget as HTMLSelectElement).value;
					page = 1;
				}}
			>
				<option value="">{m.staff_all_statuses_label()}</option>
				{#each loanStatuses as s (s)}
					<option value={s}>{titleCase(s)}</option>
				{/each}
			</Select>
		{/if}
	</FilterBar>

	{#if kind === 'kits'}
		<KitLoanList />
	{:else}
		<DataList {result} empty={m.staff_inventory_loans_empty_body()} onpage={(p) => (page = p)}>
			{#snippet children(loans)}
				<Table>
					{#snippet head()}
						<th class="w-px"><span class="sr-only">{m.staff_status_label()}</span></th>
						<th>{m.staff_inventory_loans_loan_label()}</th>
						<th>{m.staff_member_label()}</th>
						<th class="col-support whitespace-nowrap">{m.staff_due_label()}</th>
						<th class="col-extra whitespace-nowrap">{m.staff_inventory_loans_requested_label()}</th>
						<th class="col-support cell-num">{m.staff_inventory_loans_charge_label()}</th>
					{/snippet}

					{#each loans as l (l.id)}
						{@const href = resolve(`staff/inventory/loans/${l.id}`)}
						<tr class="hover cursor-pointer" use:rowLink={href}>
							<td class="w-px">
								<div class="flex w-max items-center gap-1">
									<StatusBadge status={l.status} label />
									{#if l.isOverdue}
										<Badge variant="error" size="xs">{m.staff_overdue_label()}</Badge>
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
	{/if}
</PageContent>
