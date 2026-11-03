<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { invalidateAll } from '$app/navigation';
	import { cancelTicket } from '$lib/remote/events.remote';

	const { fields } = cancelTicket;

	let {
		ticketId,
		attendeeName,
		variant = 'ghost',
		size = 'sm',
		class: className = 'text-error',
		onsuccess,
		...rest
	}: {
		ticketId: string;
		attendeeName: string;
		variant?: ButtonVariant;
		size?: ButtonSize;
		class?: string;
		onsuccess?: () => void;
		[key: string]: unknown;
	} = $props();
</script>

<Action
	action={cancelTicket}
	label={m.actions_cancel()}
	modalTitle={m.actions_cancel_ticket_modal_title()}
	successToast={m.actions_cancel_ticket_success_toast()}
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => invalidateAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.ticketId.as('hidden', ticketId)} />
		<p class="py-2">{m.actions_cancel_ticket_cancel_ticket({ attendeeName })}</p>
	{/snippet}
</Action>
