<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
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
	import Action from '#lib/components/ui/Action.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import SearchSelect from '#lib/components/ui/Form/SearchSelect.svelte';
	import { startConversation } from '#lib/remote/inbox.remote.js';
	import { startDirectConversation } from '#lib/remote/direct-messages.remote.js';
	import { searchMessageRecipients } from '#lib/remote/directory.remote.js';
	import { DIRECT_MESSAGE_BODY_MAX } from '#lib/config.js';
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
		data-testid="message-member"
		label={m.member_messages_compose_message_member()}
		modalTitle={m.member_messages_compose_message_member_2()}
		submitLabel={m.member_messages_compose_send_request()}
		successToast={m.member_messages_compose_request_sent()}
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
				<label class="fieldset w-full">
					<span class="fieldset-legend">{m.member_text()}</span>
					<!-- The picker lists everyone the viewer can already see in the
					     directory, and says nothing about who accepts messages. Marking
					     the unreachable ones would leak exactly what the silent drop in
					     startDirectThread exists to withhold. -->
					<SearchSelect
						bind:value={recipient}
						labelKey="name"
						descriptionKey="tagline"
						placeholder={m.member_messages_compose_search_members_by_name()}
						search={(q) => searchMessageRecipients({ search: q })}
					/>
					<!-- Picking someone commits a tick after the click, so submitting
					     immediately posts no recipient at all. Without this the failure is
					     a silent no-op: the field has no FormField to hang its issue on,
					     so nothing on screen changes. -->
					{#each directForm.fields.recipientId.issues() ?? [] as issue (issue.message)}
						<p class="text-sm text-error">{m.member_messages_compose_choose_who_going()}</p>
					{/each}
				</label>

				<p class="text-muted">
					{m.member_messages_compose_goes_as_message_request_they()}
				</p>

				<label class="fieldset w-full">
					<span class="fieldset-legend">{m.member_messages_compose_message()}</span>
					<textarea
						{...directForm.fields.body.as('text')}
						class="textarea w-full"
						rows="5"
						maxlength={DIRECT_MESSAGE_BODY_MAX}
						bind:value={body}
						placeholder={m.member_messages_compose_say_who_what_re_after()}></textarea>
				</label>
			</div>
		{/snippet}
	</Action>
{/if}

<Action
	action={startForm}
	label={m.member_messages_compose_message_staff()}
	modalTitle={m.member_messages_compose_message_corvmc_staff()}
	submitLabel={m.member_messages_compose_send()}
	successToast={m.member_messages_compose_message_sent()}
	variant={canMessageMembers ? 'default' : 'primary'}
	outline={canMessageMembers}
	size="sm"
	onsuccess={(result) => {
		const { threadId } = (result ?? {}) as { threadId?: string };
		if (threadId) goto(resolve(`member/messages/${threadId}`));
	}}
>
	{#snippet icon()}<IconPlus size={16} />{/snippet}
	{#snippet form()}
		<FormField
			field={startForm.fields.subject}
			label={m.member_messages_compose_what_s_about()}
			type="text"
			description={m.member_messages_compose_description()}
		/>
		<FormField
			field={startForm.fields.body}
			label={m.member_messages_compose_message()}
			type="textarea"
		/>
	{/snippet}
</Action>
