<script lang="ts">
	import Action from '$lib/components/shared/Action.svelte';
	import { IconMessage } from '@tabler/icons-svelte';
	import { startDirectConversation } from '$lib/remote/direct-messages.remote';
	import { DIRECT_MESSAGE_BODY_MAX } from '$lib/config';

	let { recipientId, recipientName }: { recipientId: string; recipientName: string } = $props();

	const { fields } = startDirectConversation;
	let body = $state('');
</script>

<Action
	action={startDirectConversation}
	label="Message"
	modalTitle={`Message ${recipientName}`}
	submitLabel="Send request"
	successToast="Request sent"
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
				This goes to {recipientName} as a message request. They'll see it in their Messages and can accept
				or decline — you'll be able to write again once they accept.
			</p>
			<label class="form-control w-full">
				<div class="label"><span class="label-text">Message</span></div>
				<textarea
					{...fields.body.as('text')}
					class="textarea w-full"
					rows="5"
					maxlength={DIRECT_MESSAGE_BODY_MAX}
					bind:value={body}
					placeholder="Say who you are and what you're after"
				></textarea>
			</label>
		</div>
	{/snippet}
</Action>
