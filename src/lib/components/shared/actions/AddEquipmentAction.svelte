<script lang="ts">
	import Action from '../Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../Button.svelte';
	import { invalidateAll } from '$app/navigation';
	import { createEquipment } from '$lib/remote/equipment.remote';
	import { Field } from '../Form';
	import { equipmentConditions } from '$lib/config';

	const { fields } = createEquipment;

	let {
		categories,
		variant = 'primary',
		size = 'sm',
		class: className = '',
		onsuccess,
		...rest
	}: {
		categories: { id: string; name: string }[];
		variant?: ButtonVariant;
		size?: ButtonSize;
		class?: string;
		onsuccess?: () => void;
		[key: string]: unknown;
	} = $props();
</script>

<Action
	action={createEquipment}
	label="Add Equipment"
	modalTitle="Add Equipment"
	successToast="Equipment added"
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => invalidateAll())}
	{...rest}
>
	{#snippet form()}
		<Field field={fields.name} type="text" label="Name" />
		<Field field={fields.description} type="textarea" label="Description" />
		<div class="grid grid-cols-2 gap-3">
			<Field
				field={fields.categoryId}
				type="select"
				label="Category"
				options={categories.map((c) => ({ value: c.id, label: c.name }))}
			/>
			<Field
				field={fields.condition}
				type="select"
				label="Condition"
				value="good"
				options={equipmentConditions.map((c) => ({ value: c, label: c }))}
			/>
		</div>
		<div class="grid grid-cols-2 gap-3">
			<Field field={fields.totalQuantity} type="number" label="Total Quantity" value={1} />
			<Field field={fields.outOfOrderQuantity} type="number" label="Out of Order" value={0} />
		</div>
		<div class="grid grid-cols-2 gap-3">
			<Field field={fields.serialNumber} type="text" label="Serial Number" />
			<Field field={fields.resourceId} type="text" label="Resource ID" />
		</div>
		<Field field={fields.notes} type="textarea" label="Notes" />
	{/snippet}
</Action>
