<script lang="ts">
	import Table from '$lib/components/ui/Table.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import SectionLabel from '$lib/components/ui/SectionLabel.svelte';
	import StickyBar from '$lib/components/ui/StickyBar.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import { Field } from '$lib/components/ui/Form';
	import { ReceiveStockAction } from '$lib/components/actions';
	import { resolve } from '$app/paths';
	import { getRestockList, markOrdered } from '$lib/remote/inventory.remote';

	/**
	 * The at-or-below-reorder-point view of the Inventory list (#2021): unpaginated
	 * and grouped by category, because it is the list taken on a shop trip. "Buy"
	 * already has what is on order taken off it.
	 */
	let { search = '', categoryId = '' }: { search?: string; categoryId?: string } = $props();

	let picked = $state<Record<string, boolean>>({});

	const data = $derived(await getRestockList());
	const needle = $derived(search.trim().toLowerCase());
	const rows = $derived(
		data.rows.filter(
			(r) =>
				(!categoryId || r.categoryId === categoryId) &&
				(!needle ||
					r.name.toLowerCase().includes(needle) ||
					(r.gtin ?? '').toLowerCase().includes(needle))
		)
	);
	const pickedRows = $derived(rows.filter((r) => picked[r.id]));
	const orderLines = $derived(
		JSON.stringify(
			pickedRows.map((r) => ({ itemId: r.id, quantityOrdered: Math.max(1, r.suggestedOrder) }))
		)
	);
	const outCount = $derived(rows.filter((r) => r.isOut).length);
	const grouped = $derived(
		Object.entries(
			rows.reduce<Record<string, typeof rows>>((acc, row) => {
				(acc[row.category.name] ??= []).push(row);
				return acc;
			}, {})
		).sort(([a], [b]) => a.localeCompare(b))
	);

	const { fields } = markOrdered;
</script>

{#if rows.length === 0}
	<EmptyState
		title="Nothing to restock"
		description="Every counted item is above its reorder point."
	/>
{:else}
	{#if outCount > 0}
		<Alert type="warning" class="mb-4">
			{outCount === 1 ? 'One item has run out.' : `${outCount} items have run out.`}
		</Alert>
	{/if}

	{#each grouped as [categoryName, group] (categoryName)}
		<SectionLabel label={categoryName} />
		<Table>
			{#snippet head()}
				<th>Item</th>
				<th class="cell-num">On hand</th>
				<th class="col-support cell-num">Reorder at</th>
				<th class="cell-num">Buy</th>
				<th class="col-support cell-num">On order</th>
				<th class="w-px"><span class="sr-only">Actions</span></th>
			{/snippet}
			{#each group as row (row.id)}
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
						<div class="flex w-max items-center gap-2">
							<Field
								name="pick_{row.id}"
								type="checkbox"
								label={undefined}
								checkboxLabel="Order"
								bind:value={picked[row.id]}
							/>
							<!-- Receiving from here: you come back from the shop with the list open. -->
							<ReceiveStockAction itemId={row.id} variant="ghost" />
						</div>
					</td>
				</tr>
			{/each}
		</Table>
	{/each}

	{#if pickedRows.length > 0}
		<!-- Sticky: the list is long and the choice is made while scrolling it. -->
		<StickyBar>
			<Form remote={markOrdered} successToast="Marked as ordered" onsuccess={() => (picked = {})}>
				<input type="hidden" name="lines" value={orderLines} />
				<div class="flex flex-wrap items-end gap-3">
					<Field field={fields.expectedAt} type="date" label="Expected" required />
					<Field field={fields.supplierName} type="text" label="Supplier" />
					<Field field={fields.reference} type="text" label="Reference" />
					<SubmitButton
						label="Mark {pickedRows.length} {pickedRows.length === 1 ? 'item' : 'items'} as ordered"
					/>
				</div>
			</Form>
		</StickyBar>
	{/if}
{/if}
