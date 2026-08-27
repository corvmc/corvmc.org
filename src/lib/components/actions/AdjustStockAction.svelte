<script lang="ts">
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { invalidateAll } from '$app/navigation';
	import { correctStock } from '$lib/remote/inventory.remote';
	import { Field } from '../ui/Form';

	const { fields } = correctStock;

	let {
		itemId,
		onHand,
		variant = 'ghost',
		size = 'sm',
		class: className = '',
		onsuccess,
		...rest
	}: {
		itemId: string;
		onHand: number;
		variant?: ButtonVariant;
		size?: ButtonSize;
		class?: string;
		onsuccess?: () => void;
		[key: string]: unknown;
	} = $props();
</script>

<Action
	action={correctStock}
	label="Stocktake"
	modalTitle="Correct the count"
	successToast="Correction recorded"
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => invalidateAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.itemId.as('hidden', itemId)} />
		<!-- The correction is itself a ledger row, so the discrepancy stays
		     visible rather than a total being quietly overwritten. -->
		<div class="mb-3 rounded bg-base-200 p-3 text-sm">
			<p>The system currently shows <strong>{onHand}</strong> on hand.</p>
			<p class="mt-1 opacity-70">
				Enter the difference, not the new total — a negative number if there are fewer than we
				thought. The correction is recorded as its own entry.
			</p>
		</div>
		<Field field={fields.delta} type="number" label="Difference" />
		<Field field={fields.notes} type="textarea" label="Why" />
	{/snippet}
</Action>
