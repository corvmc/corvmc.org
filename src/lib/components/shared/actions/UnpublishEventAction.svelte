<script lang="ts">
	import Action from '../Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../Button.svelte';
	import FormField from '../Form/FormField.svelte';
	import { invalidateAll } from '$app/navigation';
	import { unpublishEvent } from '$lib/remote/events.remote';

	const { fields } = unpublishEvent;

	let {
		eventId,
		variant = 'warning',
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
	action={unpublishEvent}
	label="Unpublish"
	modalTitle="Unpublish Event"
	successToast="Reverted to draft"
	{variant}
	{size}
	{outline}
	class={className}
	onsuccess={onsuccess ?? (() => invalidateAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.id.as('hidden', eventId)} />
		<p class="py-2">Revert this event to draft? It will no longer be visible to the public.</p>
		<FormField
			name="notes"
			type="textarea"
			label="Reason"
			description="Sent to whoever posted this and kept on the listing. Leave blank for CMC events, which notify nobody."
		/>
	{/snippet}
</Action>
