<script lang="ts">
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { invalidateAll } from '$app/navigation';
	import { returnLoan } from '$lib/remote/inventory.remote';
	import { Field } from '../ui/Form';
	import { equipmentConditions } from '$lib/config';

	const { fields } = returnLoan;
	const conditionOptions = [
		{ value: '', label: 'Not checked' },
		...equipmentConditions.map((c) => ({ value: c, label: c }))
	];

	let {
		loanId,
		chargeMessage,
		variant = 'primary',
		size = 'sm',
		class: className = '',
		onsuccess,
		...rest
	}: {
		loanId: string;
		chargeMessage?: string;
		variant?: ButtonVariant;
		size?: ButtonSize;
		class?: string;
		onsuccess?: () => void;
		[key: string]: unknown;
	} = $props();
</script>

<Action
	action={returnLoan}
	data-testid="mark-returned"
	label="Mark Returned"
	modalTitle="Confirm Return"
	successToast="Marked as returned"
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => invalidateAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.id.as('hidden', loanId)} />
		{#if chargeMessage}
			<div class="mb-3 rounded bg-base-200 p-3 text-sm">
				<p>{chargeMessage}</p>
			</div>
		{/if}
		<Field field={fields.condition} type="select" label="Condition" options={conditionOptions} />
		<Field field={fields.flagNote} type="textarea" label="Something wrong?" />
		<Field
			field={fields.flagBlocksUse}
			type="checkbox"
			label="Out of service"
			value={true}
			checkboxLabel="Keep it off the shelf until fixed"
		/>
		<Field field={fields.staffNotes} type="textarea" label="Staff Notes (optional)" />
	{/snippet}
</Action>
