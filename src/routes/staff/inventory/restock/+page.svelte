<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import SectionLabel from '$lib/components/ui/SectionLabel.svelte';
	import { ReceiveStockAction } from '$lib/components/actions';
	import { resolve } from '$app/paths';
	import { getRestockList } from '$lib/remote/inventory.remote';

	/**
	 * The shopping list.
	 *
	 * A reorder point that only produces a badge on a detail page is not doing
	 * anything — somebody still has to go looking. This is the page that turns it
	 * into an action: everything at or below its point, grouped the way a shop
	 * trip is, with the quantity to buy already worked out.
	 */
	const data = $derived(await getRestockList());

	const grouped = $derived(
		Object.entries(
			data.rows.reduce<Record<string, typeof data.rows>>((acc, row) => {
				(acc[row.category.name] ??= []).push(row);
				return acc;
			}, {})
		).sort(([a], [b]) => a.localeCompare(b))
	);
</script>

<PageHeader title="Restock" subtitle="Inventory" backHref="/staff/inventory" />

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
							{row.suggestedOrder}
							<span class="text-subtle">{row.unitOfMeasure}</span>
						</td>
						<td class="w-px">
							<!-- Receiving from here rather than the detail page: you come back
							     from the shop with the list still open. -->
							<ReceiveStockAction itemId={row.id} variant="ghost" />
						</td>
					</tr>
				{/each}
			</Table>
		{/each}
	{/if}
</PageContent>
