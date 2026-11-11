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
	import PaymentMethodIcon from '#lib/components/ui/PaymentMethodIcon.svelte';
	import CopyableId from '#lib/components/ui/CopyableId.svelte';
	import { EntityIdentity } from '#lib/components/ui/entity/index.js';
	import Button from '#lib/components/ui/Button.svelte';
	import { getStaffPayments } from '#lib/remote/users.remote.js';
	import StaffViews from '../../StaffViews.svelte';
	import { moneyViews } from '../views';
	import { formatDateTimeShort, formatCents } from '#lib/utils/format.js';

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

<PageHeader title={m.staff_payments_title()}>
	<StaffViews views={moneyViews} active="payments" />
</PageHeader>
<PageContent>
	<p class="mb-4 text-sm text-base-content/60">
		{m.staff_payments_cash_credit_settled_payments_only_text()}
	</p>
	<FilterBar activeCount={activeFilterCount} onclear={clearFilters}>
		{#snippet search()}
			<SearchInput
				bind:value={searchText}
				placeholder={m.staff_search_name_email_placeholder()}
				onsearch={(q) => {
					searchDebounced = q;
					page = 1;
				}}
			/>
		{/snippet}
		<Select
			size="sm"
			aria-label={m.staff_payments_method_label()}
			value={method}
			onchange={(e: Event) => {
				method = (e.currentTarget as HTMLSelectElement).value;
				page = 1;
			}}
		>
			<option value="">{m.staff_payments_all_methods_label()}</option>
			<option value="Cash">{m.staff_payments_cash_label()}</option>
			<option value="Credits">{m.staff_payments_credits_label()}</option>
		</Select>
		<Select
			size="sm"
			aria-label={m.staff_status_label()}
			value={status}
			onchange={(e: Event) => {
				status = (e.currentTarget as HTMLSelectElement).value;
				page = 1;
			}}
		>
			<option value="">{m.staff_all_statuses_label()}</option>
			<option value="completed">{m.staff_payments_completed_label()}</option>
			<option value="refunded">{m.staff_refunded_label()}</option>
		</Select>
		<input
			type="date"
			aria-label={m.staff_from_date_label()}
			class="input input-sm"
			bind:value={dateFrom}
			onchange={() => {
				page = 1;
			}}
		/>
		<input
			type="date"
			aria-label={m.staff_date_2_label()}
			class="input input-sm"
			bind:value={dateTo}
			onchange={() => {
				page = 1;
			}}
		/>
	</FilterBar>

	<DataList {result} empty={m.staff_payments_empty_body()} onpage={(p) => (page = p)}>
		{#snippet children(payments)}
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">{m.staff_status_label()}</span></th>
					<th>{m.staff_member_label()}</th>
					<th class="cell-num">{m.staff_amount_label()}</th>
					<th class="col-support w-px"
						><span class="sr-only">{m.staff_payments_method_label()}</span></th
					>
					<th class="col-support whitespace-nowrap">{m.staff_paid_label()}</th>
					<!-- The Stripe id is diagnostic and tiers away; the link to the
					     reservation is the row's only action and must not (#1229). -->
					<th class="col-extra">{m.staff_record_label()}</th>
					<th class="w-px"><span class="sr-only">{m.staff_reservation_label()}</span></th>
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
							<CopyableId value={p.id} label={m.staff_payments_label()} />
						</td>
						<td class="w-px">
							{#if p.reservationId}
								<div class="flex w-max justify-end">
									<Button href="/staff/reservations/{p.reservationId}" variant="ghost" size="xs">
										{m.staff_payments_view_reservation_label()}
									</Button>
								</div>
							{/if}
						</td>
					</tr>
				{/each}
			</Table>
		{/snippet}
	</DataList>
</PageContent>
