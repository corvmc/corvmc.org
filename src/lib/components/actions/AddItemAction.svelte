<script lang="ts">
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { invalidateAll } from '$app/navigation';
	import { createItem, getEquipmentCategories } from '$lib/remote/inventory.remote';
	import { Field } from '../ui/Form';
	import { itemKinds, unitsOfMeasure } from '$lib/config';

	const { fields } = createItem;

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

	/**
	 * Reorder settings only mean something for a counted item — you do not
	 * restock Blues Deluxes to a par level — so the fields appear only when they
	 * can be acted on rather than sitting greyed out.
	 */
	/**
	 * Defaulted to `serialized`, and defaulted here rather than in the schema.
	 *
	 * A stocktake is overwhelmingly one-record-per-thing — amps, mics, cables on
	 * a hook — and `bulk` opened the reorder fields, so the common case was the
	 * one that needed correcting every time. The schema cannot carry this: an
	 * unchecked box is simply absent from `FormData`, so a schema `.default()`
	 * would win over anything the operator did and could not be turned off.
	 */
	let kind = $state<'serialized' | 'bulk'>('serialized');

	const kindLabels: Record<(typeof itemKinds)[number], string> = {
		serialized: 'Serialized — one record per physical unit',
		bulk: 'Bulk — a count'
	};
</script>

<Action
	action={createItem}
	label="Add Item"
	modalTitle="Add Item"
	successToast="Item added"
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
				field={fields.kind}
				type="select"
				label="Tracked as"
				bind:value={kind}
				options={itemKinds.map((k) => ({ value: k, label: kindLabels[k] }))}
			/>
		</div>
		<div class="grid grid-cols-2 gap-3">
			<Field
				field={fields.unitOfMeasure}
				type="select"
				label="Unit"
				value="each"
				options={unitsOfMeasure.map((u) => ({ value: u, label: u }))}
			/>
			<Field field={fields.gtin} type="text" label="Barcode (UPC/EAN)" />
		</div>
		<!-- Checked by default: most of what CMC owns is there to be borrowed, and
		     "consumable" is the exception a person opts into. -->
		<Field
			field={fields.isLoanable}
			type="checkbox"
			label="Members can borrow this"
			value={true}
			description="Leave off for something that gets used up — that is what makes an item a consumable."
		/>
		{#if kind === 'bulk'}
			<div class="grid grid-cols-2 gap-3">
				<Field field={fields.reorderPoint} type="number" label="Reorder at" />
				<Field field={fields.reorderQuantity} type="number" label="Reorder quantity" />
			</div>
		{/if}
		<Field field={fields.resourceId} type="text" label="Resource ID" />
		<Field field={fields.notes} type="textarea" label="Notes" />
	{/snippet}
</Action>
