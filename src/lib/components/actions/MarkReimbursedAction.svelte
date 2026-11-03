<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { invalidateAll } from '$app/navigation';
	import { markAcquisitionReimbursed } from '$lib/remote/inventory.remote';
	import { formatCents } from '$lib/utils/format';

	const { fields } = markAcquisitionReimbursed;

	let {
		acquisitionId,
		paidByName,
		amountCents,
		variant = 'primary',
		size = 'sm',
		class: className = '',
		onsuccess,
		...rest
	}: {
		acquisitionId: string;
		paidByName?: string | null;
		amountCents?: number | null;
		variant?: ButtonVariant;
		size?: ButtonSize;
		class?: string;
		onsuccess?: () => void;
		[key: string]: unknown;
	} = $props();
</script>

<!-- The app does not move money. This records that somebody settled up, the
     same shape as recording a Form 8282 outcome: the transfer happens in a
     bank, and what is worth keeping is that a person dealt with it. -->
<Action
	action={markAcquisitionReimbursed}
	label={m.actions_mark_reimbursed_label()}
	modalTitle={m.actions_mark_reimbursed_modal_title()}
	confirm={amountCents
		? m.actions_mark_reimbursed_confirm_amount({
				name: paidByName ?? m.actions_mark_reimbursed_whoever_paid(),
				amount: formatCents(amountCents)
			})
		: m.actions_mark_reimbursed_confirm({
				name: paidByName ?? m.actions_mark_reimbursed_whoever_paid()
			})}
	successToast={m.actions_mark_reimbursed_success_toast()}
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => invalidateAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.id.as('hidden', acquisitionId)} />
	{/snippet}
</Action>
