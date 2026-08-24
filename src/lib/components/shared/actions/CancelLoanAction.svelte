<script lang="ts">
	import Action from '../Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../Button.svelte';
	import { invalidateAll } from '$app/navigation';
	import { cancelLoan } from '$lib/remote/equipment.remote';

	const { fields } = cancelLoan;

	let {
		loanId,
		label = 'Cancel',
		confirm: confirmText = 'Cancel this loan?',
		variant = 'ghost',
		size = 'sm',
		class: className = 'text-error',
		onsuccess,
		...rest
	}: {
		loanId: string;
		label?: string;
		confirm?: string;
		variant?: ButtonVariant;
		size?: ButtonSize;
		class?: string;
		onsuccess?: () => void;
		[key: string]: unknown;
	} = $props();
</script>

<Action
	action={cancelLoan}
	{label}
	modalTitle="Confirm"
	successToast="Loan cancelled"
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => invalidateAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.id.as('hidden', loanId)} />
		<p class="py-4">{confirmText}</p>
	{/snippet}
</Action>
