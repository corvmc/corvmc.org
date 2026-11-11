<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { refreshAll } from '$app/navigation';
	import { cancelTicket } from '#lib/remote/events.remote.js';

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
	label={m.actions_cancel_label()}
	modalTitle={m.actions_cancel_ticket_modal_title()}
	successToast={m.actions_cancel_ticket_success_toast()}
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => refreshAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.ticketId.as('hidden', ticketId)} />
		<p class="py-2">{m.actions_cancel_ticket_cancel_ticket_text({ attendeeName })}</p>
	{/snippet}
</Action>
