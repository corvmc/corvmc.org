<script lang="ts">
	import Action from '../Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../Button.svelte';
	import { invalidateAll } from '$app/navigation';
	import { returnLoan } from '$lib/remote/equipment.remote';
	import { Field } from '../Form';

	const { fields } = returnLoan;

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
			<div class="bg-base-200 rounded p-3 mb-3 text-sm">
				<p>{chargeMessage}</p>
			</div>
		{/if}
		<Field field={fields.staffNotes} type="textarea" label="Staff Notes (optional)" />
	{/snippet}
</Action>
