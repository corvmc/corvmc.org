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

	/**
	 * What the counter counted. Empty until they type, so the box does not open
	 * pre-filled with the number they are supposed to be checking — a default of
	 * `onHand` is an invitation to confirm the system rather than the shelf.
	 */
	let counted = $state('');

	/**
	 * The ledger stores the *difference*, and it still does: this is arithmetic
	 * moved off the operator and into the form.
	 *
	 * Counting a shelf produces a total, not a delta. Asking for the delta means
	 * every count is a subtraction done in the head, in a storage room, a few
	 * hundred times — and the sign is the easy half to get wrong, which writes a
	 * correction in exactly the wrong direction and doubles the error it was
	 * meant to fix.
	 */
	const delta = $derived.by(() => {
		if (counted.trim() === '') return null;
		const parsed = Number.parseInt(counted, 10);
		return Number.isFinite(parsed) ? parsed - onHand : null;
	});
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
				Enter what you counted. The difference is recorded as its own entry, so the discrepancy
				stays on the record rather than the total being quietly overwritten.
			</p>
		</div>
		<Field
			type="number"
			label="Counted on the shelf"
			bind:value={counted}
			min="0"
			issues={fields.delta.issues() ?? null}
		/>
		{#if delta !== null && delta !== 0}
			<p class="text-sm" class:text-error={delta < 0}>
				{delta > 0 ? 'Adding' : 'Removing'}
				{Math.abs(delta)} — {onHand} on record, {counted} counted.
			</p>
		{:else if delta === 0}
			<p class="text-subtle text-sm">Matches the record. Submitting will change nothing.</p>
		{/if}
		<!-- The service takes a delta and keeps taking one; only the question
		     asked of the operator changed. -->
		<input {...fields.delta.as('number', delta === null ? '' : String(delta))} type="hidden" />
		<Field field={fields.notes} type="textarea" label="Why" />
	{/snippet}
</Action>
