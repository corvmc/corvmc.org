<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { refreshAll } from '$app/navigation';
	import { cancelEvent } from '#lib/remote/events.remote.js';

	const { fields } = cancelEvent;

	let {
		eventId,
		variant = 'error',
		size = 'sm',
		outline = true,
		class: className = '',
		onsuccess,
		...rest
	}: {
		eventId: string;
		variant?: ButtonVariant;
		size?: ButtonSize;
		outline?: boolean;
		class?: string;
		onsuccess?: () => void;
		[key: string]: unknown;
	} = $props();
</script>

<Action
	action={cancelEvent}
	label={m.actions_cancel_event_label()}
	modalTitle={m.actions_cancel_event_title()}
	successToast={m.actions_cancelled_toast()}
	{variant}
	{size}
	{outline}
	class={className}
	onsuccess={onsuccess ?? (() => refreshAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.id.as('hidden', eventId)} />
		<p class="py-2">{m.actions_cancel_event_cancel_event_cannot_undone_text()}</p>
	{/snippet}
</Action>
