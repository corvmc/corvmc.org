<script lang="ts">
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { markItemOrdered } from '$lib/remote/inventory.remote';
	import { Field, MoneyField } from '../ui/Form';

	const { fields } = markItemOrdered;

	let {
		itemId,
		quantity = 1,
		variant = 'ghost',
		size = 'sm'
	}: { itemId: string; quantity?: number; variant?: ButtonVariant; size?: ButtonSize } = $props();
</script>

<!-- Writes a placed purchase order with one line; the item shows it as "on order" (#2022). -->
<Action
	action={markItemOrdered}
	label="Mark as ordered"
	modalTitle="Mark as ordered"
	successToast="Marked as ordered"
	{variant}
	{size}
>
	{#snippet form()}
		<input {...fields.itemId.as('hidden', itemId)} />
		<div class="grid grid-cols-2 gap-3">
			<Field
				field={fields.quantityOrdered}
				type="number"
				label="Quantity"
				value={quantity}
				min="1"
			/>
			<Field field={fields.expectedAt} type="date" label="Expected" required />
		</div>
		<Field field={fields.supplierName} type="text" label="Supplier" />
		<div class="grid grid-cols-2 gap-3">
			<Field field={fields.reference} type="text" label="Reference" />
			<MoneyField field={fields.unitCostCents} label="Unit cost" />
		</div>
		<Field field={fields.notes} type="textarea" label="Notes" />
	{/snippet}
</Action>
