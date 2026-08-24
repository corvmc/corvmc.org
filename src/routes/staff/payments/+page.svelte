<script lang="ts">
	import SearchInput from '$lib/components/shared/Form/SearchInput.svelte';
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import DataList from '$lib/components/shared/DataList.svelte';
	import Table from '$lib/components/shared/Table.svelte';
	import FilterBar from '$lib/components/shared/FilterBar.svelte';
	import Select from '$lib/components/shared/Form/Select.svelte';
	import StatusBadge from '$lib/components/shared/StatusBadge.svelte';
	import PaymentMethodIcon from '$lib/components/shared/PaymentMethodIcon.svelte';
	import CopyableId from '$lib/components/shared/CopyableId.svelte';
	import { EntityIdentity } from '$lib/components/shared/entity';
	import Button from '$lib/components/shared/Button.svelte';
	import { getStaffPayments } from '$lib/remote/users.remote';
	import { formatDateTimeShort, formatCents } from '$lib/utils/format';

	// `searchText`, not `search`: FilterBar's always-visible slot is a snippet
	// named `search`, and a snippet shadows a same-named script binding.
	let searchText = $state('');
	let method = $state('');
	let status = $state('');
	let dateFrom = $state('');
	let dateTo = $state('');
	let page = $state(1);

	let searchDebounced = $state('');
	let filters = $derived({
		search: searchDebounced || undefined,
		method: method || undefined,
		status: status || undefined,
		from: dateFrom || undefined,
		to: dateTo || undefined,
		page
	});

	let result = $derived(getStaffPayments(filters));

	const activeFilterCount = $derived(
		(searchDebounced ? 1 : 0) +
			(method ? 1 : 0) +
			(status ? 1 : 0) +
			(dateFrom ? 1 : 0) +
			(dateTo ? 1 : 0)
	);

	function clearFilters() {
		searchText = '';
		searchDebounced = '';
		method = '';
		status = '';
		dateFrom = '';
		dateTo = '';
		page = 1;
	}
</script>

<PageHeader title="Payments" />
<PageContent>
	<p class="mb-4 text-sm text-base-content/60">
		Cash and credit-settled payments only — card payments (tickets, online reservation payments) are
		recorded in the Stripe dashboard.
	</p>
	<FilterBar activeCount={activeFilterCount} onclear={clearFilters}>
		{#snippet search()}
			<SearchInput
				bind:value={searchText}
				placeholder="Search name or email..."
				onsearch={(q) => {
					searchDebounced = q;
					page = 1;
				}}
			/>
		{/snippet}
		<Select
			size="sm"
			aria-label="Method"
			value={method}
			onchange={(e: Event) => {
				method = (e.currentTarget as HTMLSelectElement).value;
				page = 1;
			}}
		>
			<option value="">All methods</option>
			<option value="Cash">Cash</option>
			<option value="Credits">Credits</option>
		</Select>
		<Select
			size="sm"
			aria-label="Status"
			value={status}
			onchange={(e: Event) => {
				status = (e.currentTarget as HTMLSelectElement).value;
				page = 1;
			}}
		>
			<option value="">All statuses</option>
			<option value="completed">Completed</option>
			<option value="refunded">Refunded</option>
		</Select>
		<input
			type="date"
			aria-label="From date"
			class="input input-sm"
			bind:value={dateFrom}
			onchange={() => {
				page = 1;
			}}
		/>
		<input
			type="date"
			aria-label="To date"
			class="input input-sm"
			bind:value={dateTo}
			onchange={() => {
				page = 1;
			}}
		/>
	</FilterBar>

	<DataList {result} empty="No payment records found" onpage={(p) => (page = p)}>
		{#snippet children(payments)}
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">Status</span></th>
					<th>Member</th>
					<th class="cell-num">Amount</th>
					<th class="col-support w-px"><span class="sr-only">Method</span></th>
					<th class="col-support whitespace-nowrap">Paid</th>
					<th class="col-extra">Record</th>
				{/snippet}

				{#each payments as p (p.id)}
					<tr class="hover">
						<td class="w-px"><StatusBadge status={p.status} /></td>
						<td class="cell-primary">
							<EntityIdentity ref={p.member} />
						</td>
						<td class="cell-num font-medium">{formatCents(p.amountCents)}</td>
						<td class="col-support w-px">
							<PaymentMethodIcon method={p.paymentMethod} />
						</td>
						<td class="col-support whitespace-nowrap">
							{formatDateTimeShort(new Date(p.paidAt))}
						</td>
						<td class="col-extra">
							<div class="flex items-center gap-2">
								<CopyableId value={p.id} label="Stripe" />
								{#if p.reservationId}
									<Button href="/staff/reservations/{p.reservationId}" variant="ghost" size="xs">
										View reservation
									</Button>
								{/if}
							</div>
						</td>
					</tr>
				{/each}
			</Table>
		{/snippet}
	</DataList>
</PageContent>
