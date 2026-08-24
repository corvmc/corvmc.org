<script lang="ts">
	import Action from '../Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../Button.svelte';
	import { invalidateAll } from '$app/navigation';
	import { cancelEvent } from '$lib/remote/events.remote';

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
	label="Cancel Event"
	modalTitle="Cancel Event"
	successToast="Cancelled"
	{variant}
	{size}
	{outline}
	class={className}
	onsuccess={onsuccess ?? (() => invalidateAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.id.as('hidden', eventId)} />
		<p class="py-2">Cancel this event? This cannot be undone.</p>
	{/snippet}
</Action>
