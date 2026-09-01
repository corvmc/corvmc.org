<script lang="ts">
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { invalidateAll } from '$app/navigation';
	import { receiveStock } from '$lib/remote/inventory.remote';
	import LocationField from '$lib/components/inventory/LocationField.svelte';
	import { Field } from '../ui/Form';
	import MemberPicker from '../ui/MemberPicker.svelte';
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

	/**
	 * A donation has to answer things a purchase does not — what it was worth and
	 * how that was arrived at — because FASB ASU 2020-07 wants both, and neither
	 * is reconstructable a year later when the report is due.
	 */
	let kind = $state<(typeof acquisitionKinds)[number]>('purchase');

	/**
	 * Who fronted the money. Blank means the collective's own card, which is the
	 * common case — so this stays out of the way until somebody fills it in.
	 */
	let paidByUserId = $state('');
	let paidByName = $state('');
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
			<Field
				field={fields.fairValueCents}
				type="number"
				label="Total fair value (cents)"
				description="The gift as a whole. Leave blank to let the per-unit values above stand for it."
			/>
			<!-- ASU 2020-07 asks whether a gift was sold or put to use, and discloses
			     the two on separate lines. Nothing could set this before, so every
			     gift on record reads as utilized. -->
			<Field
				field={fields.monetized}
				type="checkbox"
				label="Sold rather than used"
				checkboxLabel="The collective converted this gift to cash"
			/>
		{/if}
		<!-- Distinct from the donor: a volunteer who buys strings is owed for them,
		     and one who donates strings is not. -->
		<MemberPicker
			field={fields.paidByUserId}
			bind:value={paidByUserId}
			bind:name={paidByName}
			label="Paid by (leave blank if the collective paid)"
		/>
		<LocationField field={fields.locationId} />
		<Field field={fields.notes} type="textarea" label="Notes" />
	{/snippet}
</Action>
