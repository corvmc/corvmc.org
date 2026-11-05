<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { invalidateAll } from '$app/navigation';
	import { createAsset } from '#lib/remote/inventory.remote.js';
	import LocationField from '#lib/components/inventory/LocationField.svelte';
	import { Field } from '../ui/Form';
	import { equipmentConditions } from '#lib/config.js';

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
	label={m.actions_add_asset_add_unit()}
	modalTitle={m.actions_add_asset_modal_title()}
	successToast={m.actions_add_asset_success_toast()}
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
				label={m.actions_tag()}
				description={m.actions_add_asset_description()}
			/>
			<Field field={fields.serialNumber} type="text" label={m.actions_add_asset_serial_number()} />
		</div>
		<Field
			field={fields.condition}
			type="select"
			label={m.actions_condition()}
			value="good"
			options={equipmentConditions.map((c) => ({ value: c, label: c }))}
		/>
		<LocationField field={fields.locationId} />
		<Field field={fields.notes} type="textarea" label={m.actions_notes()} />
	{/snippet}
</Action>
