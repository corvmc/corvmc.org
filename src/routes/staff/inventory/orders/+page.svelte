<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { getOrders } from '$lib/remote/inventory.remote';
	import { orderStatusLabels, orderStatusBadge, type OrderStatus } from '$lib/config';
	import { formatCents, formatDateShort } from '$lib/utils/format';
	import { resolve } from '$app/paths';

	/**
	 * What is on the way.
	 *
	 * The list is a worklist rather than an archive: placed orders first, then
	 * drafts, then everything closed. "Late" is the column that earns its place —
	 * an order past its expected date with lines still outstanding is the one
	 * thing here somebody has to chase.
	 */
	const orders = $derived(await getOrders());
	const now = new Date();

	const isLate = (o: (typeof orders)[number]) =>
		o.status === 'placed' && o.expectedAt && o.expectedAt < now && !o.isComplete;
</script>

<PageHeader title="Orders" subtitle="Inventory" backHref="/staff/inventory">
	<Button href="/staff/inventory/restock" variant="ghost" size="sm">From the restock list</Button>
</PageHeader>

<PageContent>
	{#if orders.length === 0}
		<EmptyState
			title="Nothing on order"
			description="Orders start from the restock list, so what you buy is what ran out."
			actionLabel="Open the restock list"
			actionHref="/staff/inventory/restock"
		/>
	{:else}
		<Table>
			{#snippet head()}
				<th>Supplier</th>
				<th>Status</th>
				<th>Expected</th>
				<th class="cell-num">Progress</th>
				<th class="cell-num">Estimated</th>
			{/snippet}
			{#each orders as order (order.id)}
				<tr class="hover">
					<td class="cell-primary">
						<a class="link font-medium" href={resolve(`/staff/inventory/orders/${order.id}`)}>
							{order.supplierName ?? 'Unnamed supplier'}
						</a>
						{#if order.reference}
							<div class="text-subtle">{order.reference}</div>
						{/if}
					</td>
					<td>
						<Badge variant={orderStatusBadge[order.status as OrderStatus]} size="sm">
							{orderStatusLabels[order.status as OrderStatus]}
						</Badge>
						{#if isLate(order)}
							<Badge variant="error" size="sm">Late</Badge>
						{/if}
					</td>
					<td>{order.expectedAt ? formatDateShort(order.expectedAt) : '—'}</td>
					<td class="cell-num">{order.quantityReceived} / {order.quantityOrdered}</td>
					<td class="cell-num">{formatCents(order.estimatedTotalCents)}</td>
				</tr>
			{/each}
		</Table>
	{/if}
</PageContent>
