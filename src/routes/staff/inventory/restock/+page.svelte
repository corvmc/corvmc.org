<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import SectionLabel from '$lib/components/ui/SectionLabel.svelte';
	import { ReceiveStockAction } from '$lib/components/actions';
	import Button from '$lib/components/ui/Button.svelte';
	import StickyBar from '$lib/components/ui/StickyBar.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import { Field } from '$lib/components/ui/Form';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { getRestockList, startOrder } from '$lib/remote/inventory.remote';

	/**
	 * The shopping list.
	 *
	 * A reorder point that only produces a badge on a detail page is not doing
	 * anything — somebody still has to go looking. This is the page that turns it
	 * into an action: everything at or below its point, grouped the way a shop
	 * trip is, with the quantity to buy already worked out.
	 */
	const data = $derived(await getRestockList());

	/**
	 * The list gains memory.
	 *
	 * Recomputed from reorder points on every load, this page remembered nothing:
	 * buy three of five things and it simply recalculated, so it kept asking for
	 * what was already on its way. Ticking rows here raises a real order, and
	 * `listLowStock` subtracts what is on one — which is the whole reason orders
	 * exist as a table.
	 */
	let picked = $state<Record<string, boolean>>({});
	const pickedIds = $derived(Object.keys(picked).filter((id) => picked[id]));

	const { fields: orderFields } = startOrder;

	const orderLines = $derived(
		JSON.stringify(
			data.rows
				.filter((r) => picked[r.id])
				.map((r) => ({ itemId: r.id, quantityOrdered: r.suggestedOrder }))
		)
	);

	const grouped = $derived(
		Object.entries(
			data.rows.reduce<Record<string, typeof data.rows>>((acc, row) => {
				(acc[row.category.name] ??= []).push(row);
				return acc;
			}, {})
		).sort(([a], [b]) => a.localeCompare(b))
	);
</script>

<PageHeader title="Restock" subtitle="Inventory" backHref="/staff/inventory">
	<Button href="/staff/inventory/orders" variant="ghost" size="sm">Orders</Button>
</PageHeader>

<PageContent width="3xl">
	{#if data.rows.length === 0}
		<EmptyState
			title="Nothing to restock"
			description="Every counted item is above its reorder point."
		/>
	{:else}
		{#if data.outCount > 0}
			<Alert type="warning" class="mb-4">
				{data.outCount === 1
					? 'One item has run out completely.'
					: `${data.outCount} items have run out completely.`}
			</Alert>
		{/if}

		{#each grouped as [categoryName, rows] (categoryName)}
			<SectionLabel label={categoryName} />
			<Table>
				{#snippet head()}
					<th>Item</th>
					<th class="cell-num">On hand</th>
					<th class="col-support cell-num">Reorder at</th>
					<th class="cell-num">Buy</th>
					<th class="col-support cell-num">On order</th>
					<th class="w-px"><span class="sr-only">Receive</span></th>
				{/snippet}
				{#each rows as row (row.id)}
					<tr class="hover">
						<td class="cell-primary">
							<a class="font-medium" href={resolve(`/staff/inventory/${row.id}`)}>{row.name}</a>
							{#if row.isOut}
								<Badge variant="error" size="xs">Out</Badge>
							{/if}
							{#if row.gtin}
								<div class="font-mono text-subtle">{row.gtin}</div>
							{/if}
						</td>
						<td class="cell-num" class:text-error={row.isOut}>{row.onHand}</td>
						<td class="col-support cell-num">{row.reorderPoint}</td>
						<td class="cell-num font-medium">
							{#if row.suggestedOrder > 0}
								{row.suggestedOrder}
								<span class="text-subtle">{row.unitOfMeasure}</span>
							{:else}
								<span class="text-subtle">covered</span>
							{/if}
						</td>
						<td class="col-support cell-num">
							{#if row.onOrder > 0}
								<Badge variant="info" size="xs">{row.onOrder} coming</Badge>
							{:else}
								<span class="text-subtle">—</span>
							{/if}
						</td>
						<td class="w-px">
							<div class="flex items-center gap-2">
								<Field
									name="pick_{row.id}"
									type="checkbox"
									label={undefined}
									checkboxLabel="Order"
									bind:value={picked[row.id]}
								/>
								<!-- Receiving from here rather than the detail page: you come back
								     from the shop with the list still open. -->
								<ReceiveStockAction itemId={row.id} variant="ghost" />
							</div>
						</td>
					</tr>
				{/each}
			</Table>
		{/each}

		{#if pickedIds.length > 0}
			<!-- Sticky, because the list is long and the decision is made while
			     scrolling it. -->
			<StickyBar>
				<Form
					remote={startOrder}
					onsuccess={(result) => {
						if (result) goto(`/staff/inventory/orders/${result.orderId}`);
					}}
				>
					<input type="hidden" name="lines" value={orderLines} />
					<div class="flex flex-wrap items-end gap-3">
						<Field field={orderFields.supplierName} type="text" label="Supplier" />
						<Field field={orderFields.expectedAt} type="date" label="Expected" />
						<SubmitButton
							label="Order {pickedIds.length} {pickedIds.length === 1 ? 'item' : 'items'}"
						/>
					</div>
				</Form>
			</StickyBar>
		{/if}
	{/if}
</PageContent>
