<script lang="ts">
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
<RelatedList title="Login email" result={getPendingEmailChange(id)}>
	{#snippet children({ canChange, pending })}
		<p class="mb-3">
			Signs in as <strong>{email}</strong>.
		</p>
		{#if pending}
			<p class="mb-3 text-muted">
				Waiting for <strong>{pending.email}</strong> to confirm — sent
				{formatDateTimeShort(pending.requestedAt)}, link good until
				{formatDateTimeShort(pending.expiresAt)}.
			</p>
		{/if}
		{#if canChange}
			<div class="flex flex-wrap gap-2">
				<Action
					action={changeForm}
					label="Change email"
					modalTitle="Change login email"
					submitLabel="Send confirmation"
					successToast="Confirmation sent"
					variant="default"
					size="sm"
					outline
				>
					{#snippet form()}
						<input {...changeForm.fields.userId.as('hidden', id)} />
						<p class="mb-3 text-muted text-sm">
							We email a confirmation link to the new address. Nothing changes until the member
							clicks it; then they are signed out everywhere and the old address gets a notice.
						</p>
						<FormField
							field={changeForm.fields.email}
							type="email"
							label="New email"
							placeholder="member@example.com"
						/>
					{/snippet}
				</Action>
				{#if pending}
					<Action
						action={resendForm}
						label="Resend"
						modalTitle="Resend confirmation"
						successToast="Confirmation resent"
						variant="default"
						size="sm"
						outline
					>
						{#snippet form()}
							<input {...resendForm.fields.userId.as('hidden', id)} />
							<input {...resendForm.fields.email.as('hidden', pending.email)} />
							<p class="py-4">
								Send a fresh link to {pending.email}? The earlier one stops working.
							</p>
						{/snippet}
					</Action>
					<Action
						action={cancelEmailChange}
						label="Cancel request"
						modalTitle="Cancel email change"
						successToast="Request cancelled"
						variant="ghost"
						size="sm"
					>
						{#snippet form()}
							<input {...cancelEmailChange.fields.userId.as('hidden', id)} />
							<p class="py-4">
								Cancel the change to {pending.email}? The link already sent stops working.
							</p>
						{/snippet}
					</Action>
				{/if}
			</div>
		{/if}
	{/snippet}
</RelatedList>
