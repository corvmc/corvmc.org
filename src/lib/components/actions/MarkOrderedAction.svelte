<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { markItemOrdered } from '#lib/remote/inventory.remote.js';
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
	label={m.actions_mark_ordered_mark_as_ordered_label()}
	modalTitle={m.actions_mark_ordered_mark_as_ordered_title()}
	successToast={m.actions_mark_ordered_success_toast()}
	{variant}
	{size}
>
	{#snippet form()}
		<input {...fields.itemId.as('hidden', itemId)} />
		<div class="grid grid-cols-2 gap-3">
			<Field
				field={fields.quantityOrdered}
				type="number"
				label={m.actions_quantity_label()}
				value={quantity}
				min="1"
			/>
			<Field
				field={fields.expectedAt}
				type="date"
				label={m.actions_mark_ordered_expected_label()}
				required
			/>
		</div>
		<Field field={fields.supplierName} type="text" label={m.actions_supplier_label()} />
		<div class="grid grid-cols-2 gap-3">
			<Field
				field={fields.reference}
				type="text"
				label={m.actions_mark_ordered_reference_label()}
			/>
			<MoneyField field={fields.unitCostCents} label={m.actions_unit_cost_label()} />
		</div>
		<Field field={fields.notes} type="textarea" label={m.actions_notes_label()} />
	{/snippet}
</Action>
