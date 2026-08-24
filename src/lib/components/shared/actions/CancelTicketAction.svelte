<script lang="ts">
	import Action from '../Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../Button.svelte';
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
	label="Cancel"
	modalTitle="Cancel Ticket"
	successToast="Ticket cancelled"
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => invalidateAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.ticketId.as('hidden', ticketId)} />
		<p class="py-2">Cancel ticket for {attendeeName}?</p>
	{/snippet}
</Action>
