<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Table from '#lib/components/ui/Table.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import SectionLabel from '#lib/components/ui/SectionLabel.svelte';
	import StickyBar from '#lib/components/ui/StickyBar.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import { Field } from '#lib/components/ui/Form/index.js';
	import { ReceiveStockAction } from '#lib/components/actions/index.js';
	import { resolve } from '$app/paths';
	import { getRestockList, markOrdered } from '#lib/remote/inventory.remote.js';

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
		title={m.staff_inventory_restock_list_title()}
		description={m.staff_inventory_restock_list_description()}
	/>
{:else}
	{#if outCount > 0}
		<Alert type="warning" class="mb-4">
			{outCount === 1
				? m.staff_inventory_restock_list_one_item_has_run_out()
				: m.staff_inventory_restock_list_items_have_run_out({ outCount })}
		</Alert>
	{/if}

	{#each grouped as [categoryName, group] (categoryName)}
		<SectionLabel label={categoryName} />
		<Table>
			{#snippet head()}
				<th>{m.staff_item()}</th>
				<th class="cell-num">{m.staff_hand()}</th>
				<th class="col-support cell-num">{m.staff_reorder_at()}</th>
				<th class="cell-num">{m.staff_inventory_restock_list_buy()}</th>
				<th class="col-support cell-num">{m.staff_order()}</th>
				<th class="w-px"><span class="sr-only">{m.staff_actions()}</span></th>
			{/snippet}
			{#each group as row (row.id)}
				<tr class="hover">
					<td class="cell-primary">
						<a class="font-medium" href={resolve(`staff/inventory/${row.id}`)}>{row.name}</a>
						{#if row.isOut}
							<Badge variant="error" size="xs">{m.staff_inventory_restock_list_out()}</Badge>
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
							<span class="text-subtle">{m.staff_inventory_restock_list_covered()}</span>
						{/if}
					</td>
					<td class="col-support cell-num">
						{#if row.onOrder > 0}
							<Badge variant="info" size="xs"
								>{m.staff_inventory_restock_list_coming({ onOrder: row.onOrder })}</Badge
							>
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
								checkboxLabel={m.staff_order_2()}
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
			<Form
				remote={markOrdered}
				successToast={m.staff_inventory_restock_list_success_toast()}
				onsuccess={() => (picked = {})}
			>
				<input {...markOrdered.fields.lines.as('hidden', orderLines)} />
				<div class="flex flex-wrap items-end gap-3">
					<Field field={fields.expectedAt} type="date" label={m.staff_expected()} required />
					<Field field={fields.supplierName} type="text" label={m.staff_supplier()} />
					<Field field={fields.reference} type="text" label={m.staff_reference()} />
					<Field field={fields.notes} type="text" label={m.staff_notes()} />
					<SubmitButton
						label={m.staff_inventory_restock_list_mark_as_ordered({
							length: pickedRows.length,
							value: pickedRows.length === 1 ? 'item' : 'items'
						})}
					/>
				</div>
			</Form>
		</StickyBar>
	{/if}
{/if}
