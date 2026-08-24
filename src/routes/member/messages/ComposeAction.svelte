<script lang="ts">
	/**
	 * Starting a conversation, of either kind.
	 *
	 * Two buttons rather than one modal with a mode switch: `Action` renders a
	 * single `<Form remote={…}>`, and these post to genuinely different remotes
	 * with different fields — a staff thread is addressed by subject, a member
	 * thread by recipient. Folding them together would mean a form that changes
	 * which endpoint it targets halfway through being filled in.
	 */
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { IconPlus, IconUsers } from '@tabler/icons-svelte';
	import Action from '$lib/components/shared/Action.svelte';
	import FormField from '$lib/components/shared/Form/FormField.svelte';
	import SearchSelect from '$lib/components/shared/Form/SearchSelect.svelte';
	import { startConversation } from '$lib/remote/inbox.remote';
	import { startDirectConversation } from '$lib/remote/direct-messages.remote';
	import { searchMessageRecipients } from '$lib/remote/directory.remote';
	import { DIRECT_MESSAGE_BODY_MAX } from '$lib/config';
	import { refreshConversations } from './list-state.svelte';

	let { canMessageMembers = false }: { canMessageMembers?: boolean } = $props();

	const startForm = startConversation.for('new-conversation');
	const directForm = startDirectConversation.for('new-direct');

	type Recipient = { id: string; name: string; tagline: string | null };
	let recipient = $state<Recipient | null>(null);
	let body = $state('');
</script>

{#if canMessageMembers}
	<Action
		action={directForm}
		label="Message a Member"
		modalTitle="Message a member"
		submitLabel="Send request"
		successToast="Request sent"
		variant="primary"
		size="sm"
		canSubmit={!!recipient && body.trim().length > 0}
		onsuccess={() => {
			recipient = null;
			body = '';
			void refreshConversations();
		}}
	>
		{#snippet icon()}<IconUsers size={16} />{/snippet}
		{#snippet form()}
			<div class="space-y-3">
				<!-- The hidden field comes from the remote form, not from SearchSelect's
				     own `name` prop: a remote form encodes its field names, so a plain
				     `name="recipientId"` arrives as nothing and the submit fails Zod
				     with no visible field to hang the issue on. -->
				{#if recipient}
					<input {...directForm.fields.recipientId.as('hidden', recipient.id)} />
				{/if}
				<label class="form-control w-full">
					<div class="label"><span class="label-text">To</span></div>
					<!-- The picker lists everyone the viewer can already see in the
					     directory, and says nothing about who accepts messages. Marking
					     the unreachable ones would leak exactly what the silent drop in
					     startDirectThread exists to withhold. -->
					<SearchSelect
						bind:value={recipient}
						labelKey="name"
						descriptionKey="tagline"
						placeholder="Search members by name..."
						search={(q) => searchMessageRecipients({ search: q })}
					/>
					<!-- Picking someone commits a tick after the click, so submitting
					     immediately posts no recipient at all. Without this the failure is
					     a silent no-op: the field has no FormField to hang its issue on,
					     so nothing on screen changes. -->
					{#each directForm.fields.recipientId.issues() ?? [] as issue (issue.message)}
						<p class="text-error text-sm">Choose who this is going to.</p>
					{/each}
				</label>

				<p class="text-muted">
					This goes as a message request. They'll see it in their Messages and can accept or decline
					— you'll be able to write again once they accept.
				</p>

				<label class="form-control w-full">
					<div class="label"><span class="label-text">Message</span></div>
					<textarea
						{...directForm.fields.body.as('text')}
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
{/if}

<Action
	action={startForm}
	label="Message Staff"
	modalTitle="Message CorvMC staff"
	submitLabel="Send"
	successToast="Message sent"
	variant={canMessageMembers ? 'default' : 'primary'}
	outline={canMessageMembers}
	size="sm"
	onsuccess={(result) => {
		const { threadId } = (result ?? {}) as { threadId?: string };
		if (threadId) goto(resolve(`/member/messages/${threadId}`));
	}}
>
	{#snippet icon()}<IconPlus size={16} />{/snippet}
	{#snippet form()}
		<FormField
			name="subject"
			label="What's this about?"
			type="text"
			description="A short summary helps staff route your message."
		/>
		<FormField name="body" label="Message" type="textarea" />
	{/snippet}
</Action>
