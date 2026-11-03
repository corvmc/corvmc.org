<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { page } from '$app/state';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import DefinitionList from '#lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '#lib/components/ui/DefinitionList/Fact.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import {
		getOrder,
		markOrderPlaced,
		dropOrder,
		closeOrder,
		reopenOrderForm
	} from '#lib/remote/inventory.remote.js';
	import { ReopenAction } from '#lib/components/actions/index.js';
	import { orderStatusLabels, orderStatusBadge, type OrderStatus } from '#lib/config.js';
	import { formatCents, formatDateShort } from '#lib/utils/format.js';
	import { isOrderLate } from '#lib/utils/order-late.js';
	import { resolve } from '$app/paths';

	/**
	 * One order: what was promised, what has turned up, what is still coming.
	 *
	 * Receiving does not happen here. It opens the intake page prefilled from
	 * these lines, because receiving *is* intake — the goods land through the
	 * same path every other arrival uses, so the ledger cannot fork on whether
	 * something happened to be ordered first.
	 */
	const id = $derived(page.params.id!);
	const order = $derived(await getOrder(id));

	const status = $derived(order.status as OrderStatus);
	const outstanding = $derived(order.lines.filter((l) => l.outstanding > 0));
	const late = $derived(
		isOrderLate({
			status: order.status,
			expectedAt: order.expectedAt,
			isComplete: outstanding.length === 0
		})
	);
</script>

<PageHeader
	width="3xl"
	title={order.supplierName ?? m.staff_order_2()}
	subtitle={m.staff_order_2()}
>
	<Badge variant={orderStatusBadge[status]} size="md">{orderStatusLabels[status]}</Badge>
	{#if late}
		<Badge variant="error" size="md">{m.staff_late()}</Badge>
	{/if}
	{#if status === 'placed' && outstanding.length > 0}
		<Button href={`/staff/inventory/intake?order=${order.id}`} variant="primary" size="sm">
			{m.staff_receive()}
		</Button>
	{/if}
</PageHeader>

<PageContent width="3xl">
	{#if status === 'draft'}
		<Alert type="info" class="mb-4">
			{m.staff_inventory_orders_id_draft_still_shopping_list_nothing()}
		</Alert>
	{/if}

	<div class="mb-6 grid gap-6 lg:grid-cols-[2fr_1fr]">
		<InfoCard title={m.staff_inventory_orders_id_what_was_ordered()}>
			<Table>
				{#snippet head()}
					<th>{m.staff_item()}</th>
					<th class="cell-num">{m.staff_inventory_orders_id_ordered()}</th>
					<th class="cell-num">{m.staff_received()}</th>
					<th class="cell-num">{m.staff_each()}</th>
				{/snippet}
				{#each order.lines as line (line.id)}
					<tr class="hover">
						<td class="cell-primary">
							<a class="link" href={resolve(`/staff/inventory/${line.itemId}`)}>{line.item.name}</a>
							{#if line.outstanding > 0 && status === 'placed'}
								<Badge variant="warning" size="xs"
									>{m.staff_inventory_orders_id_still_out({ outstanding: line.outstanding })}</Badge
								>
							{/if}
						</td>
						<td class="cell-num">{line.quantityOrdered}</td>
						<td class="cell-num">{line.quantityReceived}</td>
						<td class="cell-num">
							{line.unitCostCents == null ? '—' : formatCents(line.unitCostCents)}
						</td>
					</tr>
				{/each}
			</Table>
		</InfoCard>

		<div class="space-y-6">
			<InfoCard title={m.staff_order_2()} class="bg-base-200 shadow-none">
				<DefinitionList>
					<Fact label={m.staff_reference()}>{order.reference ?? '—'}</Fact>
					<Fact label={m.staff_inventory_orders_id_placed()}>
						{order.placedAt ? formatDateShort(order.placedAt) : m.staff_not_yet()}
					</Fact>
					<Fact label={m.staff_expected()} class={late ? 'text-error' : ''}>
						{order.expectedAt ? formatDateShort(order.expectedAt) : '—'}
					</Fact>
					<Fact label={m.staff_inventory_orders_id_estimated()}
						>{formatCents(order.estimatedTotalCents)}</Fact
					>
					<Fact label={m.staff_inventory_orders_id_raised_by()}>{order.createdByName ?? '—'}</Fact>
				</DefinitionList>
				{#if order.notes}
					<p class="mt-3 whitespace-pre-wrap">{order.notes}</p>
				{/if}
			</InfoCard>

			{#if order.arrivals.length > 0}
				<InfoCard title={m.staff_what_arrived()}>
					<!-- The receipts this order produced. An order is a promise; these
					     are the acquisitions that made it true. -->
					<ul class="space-y-1">
						{#each order.arrivals as arrival (arrival.id)}
							<li>
								<a class="link" href={resolve(`/staff/inventory/acquisitions/${arrival.id}`)}>
									{formatDateShort(arrival.occurredAt)}
								</a>
							</li>
						{/each}
					</ul>
				</InfoCard>
			{/if}

			<!-- No card once the order is closed: the whole body is four words, and
			     a titled box around one sentence is chrome (#1078). -->
			{#if status !== 'draft' && status !== 'placed'}
				<div class="flex items-center justify-between gap-2">
					<p class="text-subtle">{m.staff_inventory_orders_id_order_closed()}</p>
					<ReopenAction action={reopenOrderForm} id={order.id} capability="inventory.reopen">
						{(order.placedAt
							? m.staff_inventory_orders_id_back_placed_what_was_received
							: m.staff_inventory_orders_id_back_draft_what_was_received)()}
					</ReopenAction>
				</div>
			{:else}
				<InfoCard title={m.staff_inventory_orders_id_next_step()}>
					{#if status === 'draft'}
						<Form
							remote={markOrderPlaced}
							successToast={m.staff_inventory_orders_id_order_placed()}
						>
							<input {...markOrderPlaced.fields.id.as('hidden', order.id)} />
							<SubmitButton label={m.staff_inventory_orders_id_mark_as_placed()} />
						</Form>
						<div class="mt-3">
							<Form remote={dropOrder} successToast={m.staff_inventory_orders_id_order_cancelled()}>
								<input {...dropOrder.fields.id.as('hidden', order.id)} />
								<SubmitButton label={m.staff_inventory_orders_id_cancel_order()} variant="ghost" />
							</Form>
						</div>
					{:else if status === 'placed'}
						<p class="mb-3 text-subtle">
							{m.staff_inventory_orders_id_receiving_opens_intake_page_with()}
						</p>
						<Form remote={closeOrder} successToast={m.staff_inventory_orders_id_order_closed_2()}>
							<input {...closeOrder.fields.id.as('hidden', order.id)} />
							<SubmitButton label={m.staff_inventory_orders_id_close_short()} variant="ghost" />
						</Form>
						<p class="mt-2 text-subtle text-sm">
							{m.staff_inventory_orders_id_use_when_rest_never_coming()}
						</p>
					{/if}
				</InfoCard>
			{/if}
		</div>
	</div>
</PageContent>
