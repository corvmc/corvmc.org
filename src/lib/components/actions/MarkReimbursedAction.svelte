<script lang="ts">
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
	label="Mark reimbursed"
	modalTitle="Mark as reimbursed"
	confirm={`Record that ${paidByName ?? 'whoever paid'} has been paid back${
		amountCents ? ` for ${formatCents(amountCents)}` : ''
	}. This does not send any money — it records that the transfer has happened.`}
	successToast="Marked reimbursed"
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
