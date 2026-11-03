<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import {
		getPendingEmailChange,
		requestEmailChange,
		cancelEmailChange
	} from '$lib/remote/email-change.remote';
	import { RelatedList } from '$lib/components/ui/entity';
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import { formatDateTimeShort } from '$lib/utils/format';

	let { id, email }: { id: string; email: string } = $props();

	const changeForm = requestEmailChange.for('change');
	const resendForm = requestEmailChange.for('resend');
</script>

<!--
	The address is the login, so staff only propose one: it applies when the
	member confirms from the new mailbox. Sits outside the Account Info <Form>,
	whose field stays read-only.
-->
<RelatedList
	title={m.staff_members_id_email_change_card_title()}
	result={getPendingEmailChange(id)}
>
	{#snippet children({ canChange, pending })}
		<p class="mb-3">
			<ParaglideMessage message={m.staff_members_id_email_change_card_signs_as} inputs={{ email }}
				>{#snippet strong({ children })}<strong>{@render children?.()}</strong
					>{/snippet}</ParaglideMessage
			>
		</p>
		{#if pending}
			<p class="mb-3 text-muted">
				<ParaglideMessage
					message={m.staff_members_id_email_change_card_waiting_confirm_sent_link}
					inputs={{
						email: pending.email,
						formatDateTimeShort: formatDateTimeShort(pending.requestedAt),
						formatDateTimeShort2: formatDateTimeShort(pending.expiresAt)
					}}
					>{#snippet strong({ children })}<strong>{@render children?.()}</strong
						>{/snippet}</ParaglideMessage
				>
			</p>
		{/if}
		{#if canChange}
			<div class="flex flex-wrap gap-2">
				<Action
					action={changeForm}
					label={m.staff_members_id_email_change_card_change_email()}
					modalTitle={m.staff_members_id_email_change_card_change_login_email()}
					submitLabel={m.staff_members_id_email_change_card_submit_label()}
					successToast={m.staff_members_id_email_change_card_confirmation_sent()}
					variant="default"
					size="sm"
					outline
				>
					{#snippet form()}
						<input {...changeForm.fields.userId.as('hidden', id)} />
						<p class="mb-3 text-muted text-sm">
							{m.staff_members_id_email_change_card_we_email_confirmation_lin()}
						</p>
						<FormField
							field={changeForm.fields.email}
							type="email"
							label={m.staff_members_id_email_change_card_new_email()}
							placeholder={m.staff_members_id_email_change_card_placeholder()}
						/>
					{/snippet}
				</Action>
				{#if pending}
					<Action
						action={resendForm}
						label={m.staff_resend()}
						modalTitle={m.staff_members_id_email_change_card_resend_confirmation()}
						successToast={m.staff_members_id_email_change_card_confirmation_resent()}
						variant="default"
						size="sm"
						outline
					>
						{#snippet form()}
							<input {...resendForm.fields.userId.as('hidden', id)} />
							<input {...resendForm.fields.email.as('hidden', pending.email)} />
							<p class="py-4">
								{m.staff_members_id_email_change_card_send_fresh_link_earlier_o({
									email: pending.email
								})}
							</p>
						{/snippet}
					</Action>
					<Action
						action={cancelEmailChange}
						label={m.staff_cancel_request()}
						modalTitle={m.staff_members_id_email_change_card_cancel_email_change()}
						successToast={m.staff_request_cancelled()}
						variant="ghost"
						size="sm"
					>
						{#snippet form()}
							<input {...cancelEmailChange.fields.userId.as('hidden', id)} />
							<p class="py-4">
								{m.staff_members_id_email_change_card_cancel_change_link_alread({
									email: pending.email
								})}
							</p>
						{/snippet}
					</Action>
				{/if}
			</div>
		{/if}
	{/snippet}
</RelatedList>
