<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { refreshAll } from '$app/navigation';
	import { cancelLoan } from '#lib/remote/inventory.remote.js';

	const { fields } = cancelLoan;

	let {
		loanId,
		label = m.actions_cancel_label(),
		confirm: confirmText = m.actions_cancel_loan_confirm_body(),
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
	modalTitle={m.actions_confirm_title()}
	successToast={m.actions_cancel_loan_success_toast()}
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => refreshAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.id.as('hidden', loanId)} />
		<p class="py-4">{confirmText}</p>
	{/snippet}
</Action>
