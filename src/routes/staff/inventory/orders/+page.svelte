<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import DataList from '#lib/components/ui/DataList.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import FilterBar from '#lib/components/ui/FilterBar.svelte';
	import Select from '#lib/components/ui/Form/Select.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import { rowLink } from '#lib/actions/row-link.js';
	import { resolve } from '$app/paths';
	import {
		orderStatuses,
		orderStatusLabels,
		orderStatusBadge,
		type OrderStatus
	} from '#lib/config.js';
	import { formatCents, formatDateShort } from '#lib/utils/format.js';
	import { isOrderLate } from '#lib/utils/order-late.js';
	import { getStaffOrders } from '#lib/remote/inventory.remote.js';
	import StaffViews from '../../StaffViews.svelte';
	import { gearViews } from '../views';

	let status = $state<OrderStatus | ''>('');
	let page = $state(1);

	const result = $derived(getStaffOrders({ status: status || undefined, page }));
</script>

<PageHeader title={m.staff_gear_title()} documentTitle={m.staff_gear_orders_title()}>
	<StaffViews views={gearViews} active="orders" />
</PageHeader>
<PageContent>
	<FilterBar
		activeCount={status ? 1 : 0}
		onclear={() => {
			status = '';
			page = 1;
		}}
	>
		<Select
			size="sm"
			aria-label={m.staff_status_label()}
			value={status}
			onchange={(e: Event) => {
				status = (e.currentTarget as HTMLSelectElement).value as OrderStatus | '';
				page = 1;
			}}
		>
			<option value="">{m.staff_all_statuses_label()}</option>
			{#each orderStatuses as s (s)}
				<option value={s}>{orderStatusLabels[s]}</option>
			{/each}
		</Select>
	</FilterBar>

	<DataList {result} empty={m.staff_inventory_orders_empty_body()} onpage={(p) => (page = p)}>
		{#snippet children(orders)}
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">{m.staff_status_label()}</span></th>
					<th>{m.staff_supplier_label()}</th>
					<th class="col-support whitespace-nowrap">{m.staff_expected_label()}</th>
					<th class="col-support cell-num">{m.staff_received_label()}</th>
					<th class="col-extra cell-num">{m.staff_total_label()}</th>
				{/snippet}

				{#each orders as o (o.id)}
					<tr class="hover cursor-pointer" use:rowLink={resolve(`staff/inventory/orders/${o.id}`)}>
						<td class="w-px">
							<div class="flex w-max items-center gap-1">
								<Badge variant={orderStatusBadge[o.status]} size="sm"
									>{orderStatusLabels[o.status]}</Badge
								>
								{#if isOrderLate(o)}
									<Badge variant="error" size="xs">{m.staff_late_label()}</Badge>
								{/if}
							</div>
						</td>
						<td class="cell-primary">
							<div class="font-medium">{o.supplierName ?? m.staff_order_2_2_text()}</div>
							{#if o.reference}
								<div class="truncate text-subtle">{o.reference}</div>
							{/if}
						</td>
						<td class="col-support whitespace-nowrap">
							{o.expectedAt ? formatDateShort(o.expectedAt) : '—'}
						</td>
						<td class="col-support cell-num">{o.quantityReceived} / {o.quantityOrdered}</td>
						<td class="col-extra cell-num">
							{o.estimatedTotalCents > 0 ? formatCents(o.estimatedTotalCents) : '—'}
						</td>
					</tr>
				{/each}
			</Table>
		{/snippet}
	</DataList>
</PageContent>
