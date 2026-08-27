<script lang="ts">
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { invalidateAll } from '$app/navigation';
	import { receiveStock, getLocations } from '$lib/remote/inventory.remote';
	import { Field } from '../ui/Form';
	import { acquisitionKinds, acquisitionKindLabels } from '$lib/config';

	const { fields } = receiveStock;

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

	const locations = $derived(await getLocations());

	/**
	 * A donation has to answer things a purchase does not — what it was worth and
	 * how that was arrived at — because FASB ASU 2020-07 wants both, and neither
	 * is reconstructable a year later when the report is due.
	 */
	let kind = $state<(typeof acquisitionKinds)[number]>('purchase');
</script>

<Action
	action={receiveStock}
	label="Receive"
	modalTitle="Receive stock"
	successToast="Stock received"
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => invalidateAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.itemId.as('hidden', itemId)} />
		<div class="grid grid-cols-2 gap-3">
			<Field field={fields.quantity} type="number" label="Quantity" value={1} />
			<Field
				field={fields.kind}
				type="select"
				label="How it arrived"
				bind:value={kind}
				options={acquisitionKinds.map((k) => ({ value: k, label: acquisitionKindLabels[k] }))}
			/>
		</div>
		<Field
			field={fields.sourceName}
			type="text"
			label={kind === 'purchase' ? 'Supplier' : 'Donor / grantor'}
		/>
		<div class="grid grid-cols-2 gap-3">
			<Field
				field={fields.unitValueCents}
				type="number"
				label={kind === 'purchase' ? 'Unit cost (cents)' : 'Fair value each (cents)'}
			/>
			<Field field={fields.reference} type="text" label="Reference / receipt no." />
		</div>
		{#if kind !== 'purchase'}
			<Field
				field={fields.fairValueBasis}
				type="text"
				label="How the value was determined"
				description="Required for the gifts-in-kind disclosure — e.g. comparable sales, appraisal."
			/>
			<Field field={fields.intendedUse} type="text" label="Intended use" />
		{/if}
		{#if locations.length > 0}
			<Field
				field={fields.locationId}
				type="select"
				label="Location"
				options={[
					{ value: '', label: 'Unassigned' },
					...locations.map((l) => ({ value: l.id, label: l.name }))
				]}
			/>
		{/if}
		<Field field={fields.notes} type="textarea" label="Notes" />
	{/snippet}
</Action>
