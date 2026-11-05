<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import FormField from '../ui/Form/FormField.svelte';
	import { invalidateAll } from '$app/navigation';
	import { unpublishEvent } from '#lib/remote/events.remote.js';

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
	label={m.actions_unpublish()}
	modalTitle={m.actions_unpublish_event_modal_title()}
	successToast={m.actions_unpublish_event_success_toast()}
	{variant}
	{size}
	{outline}
	class={className}
	onsuccess={onsuccess ?? (() => invalidateAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.id.as('hidden', eventId)} />
		<p class="py-2">{m.actions_unpublish_event_revert_event_draft_will_no()}</p>
		<FormField
			field={unpublishEvent.fields.notes}
			type="textarea"
			label={m.actions_reason()}
			description={m.actions_unpublish_event_description()}
		/>
	{/snippet}
</Action>
