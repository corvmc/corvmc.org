<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import Action from '$lib/components/ui/Action.svelte';
	import { IconMessage } from '@tabler/icons-svelte';
	import { startDirectConversation } from '$lib/remote/direct-messages.remote';
	import { DIRECT_MESSAGE_BODY_MAX } from '$lib/config';

	let { recipientId, recipientName }: { recipientId: string; recipientName: string } = $props();

	const { fields } = startDirectConversation;
	let body = $state('');
</script>

<Action
	action={startDirectConversation}
	label={m.actions_message_member_label()}
	modalTitle={m.actions_message_member_modal_title({ recipientName })}
	submitLabel={m.actions_message_member_submit_label()}
	successToast={m.actions_message_member_success_toast()}
	variant="primary"
	size="sm"
	canSubmit={body.trim().length > 0}
	onsuccess={() => {
		body = '';
	}}
>
	{#snippet icon()}<IconMessage size={16} />{/snippet}
	{#snippet form()}
		<input {...fields.recipientId.as('hidden', recipientId)} />
		<div class="space-y-3">
			<p class="text-muted">
				{m.actions_message_member_goes_as_message_request_they({ recipientName })}
			</p>
			<label class="fieldset w-full">
				<span class="fieldset-legend">{m.actions_message_member_label()}</span>
				<textarea
					{...fields.body.as('text')}
					class="textarea w-full"
					rows="5"
					maxlength={DIRECT_MESSAGE_BODY_MAX}
					bind:value={body}
					placeholder={m.actions_message_member_placeholder()}></textarea>
			</label>
		</div>
	{/snippet}
</Action>
