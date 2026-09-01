<script lang="ts">
	import { page } from '$app/state';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import DefinitionList from '$lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '$lib/components/ui/DefinitionList/Fact.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import { getOrder, markOrderPlaced, dropOrder, closeOrder } from '$lib/remote/inventory.remote';
	import { orderStatusLabels, orderStatusBadge, type OrderStatus } from '$lib/config';
	import { formatCents, formatDateShort } from '$lib/utils/format';
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
</script>

<PageHeader
	title={order.supplierName ?? 'Order'}
	subtitle="Order"
	backHref="/staff/inventory/orders"
>
	<Badge variant={orderStatusBadge[status]} size="md">{orderStatusLabels[status]}</Badge>
	{#if status === 'placed' && outstanding.length > 0}
		<Button href={`/staff/inventory/intake?order=${order.id}`} variant="primary" size="sm">
			Receive
		</Button>
	{/if}
</PageHeader>

<PageContent width="3xl">
	{#if status === 'draft'}
		<Alert type="info" class="mb-4">
			A draft is still a shopping list — nothing is on the way and the restock list still counts
			these as missing. Placing it is what changes that.
		</Alert>
	{/if}

	<div class="mb-6 grid gap-6 lg:grid-cols-[2fr_1fr]">
		<InfoCard title="What was ordered">
			<Table>
				{#snippet head()}
					<th>Item</th>
					<th class="cell-num">Ordered</th>
					<th class="cell-num">Received</th>
					<th class="cell-num">Each</th>
				{/snippet}
				{#each order.lines as line (line.id)}
					<tr class="hover">
						<td class="cell-primary">
							<a class="link" href={resolve(`/staff/inventory/${line.itemId}`)}>{line.item.name}</a>
							{#if line.outstanding > 0 && status === 'placed'}
								<Badge variant="warning" size="xs">{line.outstanding} still out</Badge>
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
			<InfoCard title="Order" class="bg-base-200 shadow-none">
				<DefinitionList>
					<Fact label="Reference">{order.reference ?? '—'}</Fact>
					<Fact label="Placed">
						{order.placedAt ? formatDateShort(order.placedAt) : 'Not yet'}
					</Fact>
					<Fact label="Expected">
						{order.expectedAt ? formatDateShort(order.expectedAt) : '—'}
					</Fact>
					<Fact label="Estimated">{formatCents(order.estimatedTotalCents)}</Fact>
					<Fact label="Raised by">{order.createdByName ?? '—'}</Fact>
				</DefinitionList>
				{#if order.notes}
					<p class="mt-3 whitespace-pre-wrap">{order.notes}</p>
				{/if}
			</InfoCard>

			{#if order.arrivals.length > 0}
				<InfoCard title="What arrived">
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

			<InfoCard title="Next step">
				{#if status === 'draft'}
					<Form remote={markOrderPlaced} successToast="Order placed">
						<input {...markOrderPlaced.fields.id.as('hidden', order.id)} />
						<SubmitButton label="Mark as placed" />
					</Form>
					<div class="mt-3">
						<Form remote={dropOrder} successToast="Order cancelled">
							<input {...dropOrder.fields.id.as('hidden', order.id)} />
							<SubmitButton label="Cancel this order" variant="ghost" />
						</Form>
					</div>
				{:else if status === 'placed'}
					<p class="mb-3 text-subtle">
						Receiving opens the intake page with these lines already filled in. Partial deliveries
						are normal — the order stays open until every line is met.
					</p>
					<Form remote={closeOrder} successToast="Order closed">
						<input {...closeOrder.fields.id.as('hidden', order.id)} />
						<SubmitButton label="Close it short" variant="ghost" />
					</Form>
					<p class="mt-2 text-subtle text-sm">
						Use that when the rest is never coming — an order left open keeps suppressing restock
						suggestions for goods that will not arrive.
					</p>
				{:else}
					<p class="text-subtle">This order is closed.</p>
				{/if}
			</InfoCard>
		</div>
	</div>
</PageContent>
