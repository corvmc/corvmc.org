<script lang="ts">
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { invalidateAll } from '$app/navigation';
	import { createAsset } from '$lib/remote/inventory.remote';
	import LocationField from '$lib/components/inventory/LocationField.svelte';
	import { Field } from '../ui/Form';
	import { equipmentConditions } from '$lib/config';

	const { fields } = createAsset;

	let {
		itemId,
		variant = 'primary',
		size = 'sm',
		class: className = '',
		onsuccess,
		...rest
	}: {
		itemId: string;
		variant?: ButtonVariant;
		size?: ButtonSize;
		class?: string;
		onsuccess?: () => void;
		[key: string]: unknown;
	} = $props();
</script>

<Action
	action={createAsset}
	label="Add Unit"
	modalTitle="Add a unit"
	successToast="Unit added"
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => invalidateAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.itemId.as('hidden', itemId)} />
		<div class="grid grid-cols-2 gap-3">
			<Field
				field={fields.assetTag}
				type="text"
				label="Tag"
				description="Scan or type the printed tag. Can be left blank and bound later."
			/>
			<Field field={fields.serialNumber} type="text" label="Serial number" />
		</div>
		<Field
			field={fields.condition}
			type="select"
			label="Condition"
			value="good"
			options={equipmentConditions.map((c) => ({ value: c, label: c }))}
		/>
		<LocationField field={fields.locationId} />
		<Field field={fields.notes} type="textarea" label="Notes" />
	{/snippet}
</Action>
