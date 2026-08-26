<script lang="ts">
	import Action from '../Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../Button.svelte';
	import { invalidateAll } from '$app/navigation';
	import { createEquipment, getEquipmentCategories } from '$lib/remote/equipment.remote';
	import { Field } from '../Form';
	import { equipmentConditions } from '$lib/config';

	const { fields } = createEquipment;

	let {
		variant = 'primary',
		size = 'sm',
		class: className = '',
		onsuccess,
		...rest
	}: {
		variant?: ButtonVariant;
		size?: ButtonSize;
		class?: string;
		onsuccess?: () => void;
		[key: string]: unknown;
	} = $props();

	/**
	 * The category list loads here rather than arriving as a prop, so the page that renders this
	 * button is not holding a second remote query for it. Same move #270 made for
	 * GrantCertificationAction, and the same reason `getEquipmentCategories` cannot be folded
	 * into a page query — see CategoryOptions.
	 *
	 * Below `$props()`, and that matters: a top-level await suspends the script body, so a
	 * `$props()` call after one is past synchronous init.
	 */
	const categories = $derived(await getEquipmentCategories());
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
