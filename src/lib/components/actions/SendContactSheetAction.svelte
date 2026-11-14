<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import { sendContactSheetLink } from '#lib/remote/contact-sheet.remote.js';
	import { toastDelivery } from '#lib/utils/delivery-toast.js';

	let {
		entryId,
		actName,
		defaultEmail = '',
		variant = 'default',
		size = 'sm',
		outline = true,
		class: className = '',
		onsuccess,
		...rest
	}: {
		entryId: string;
		actName?: string | null;
		/** The slot's booking contact, when the advance already captured one. */
		defaultEmail?: string;
		variant?: ButtonVariant;
		size?: ButtonSize;
		outline?: boolean;
		class?: string;
		onsuccess?: () => void;
	} = $props();

	const fields = sendContactSheetLink.fields;
	// svelte-ignore state_referenced_locally
	let email = $state(defaultEmail);
	// The link just issued, so staff can copy it; the toast says whether the email went.
	let issued = $state<{ url: string; sent: boolean } | null>(null);

	function handleSuccess(result?: unknown) {
		const r = result as { url?: string; sent?: boolean } | undefined;
		if (r?.url) issued = { url: r.url, sent: r.sent === true };
		toastDelivery(
			result,
			{
				sent: m.actions_send_contact_sheet_success_toast(),
				notSent: m.actions_send_contact_sheet_not_sent_toast()
			},
			'sent'
		);
		onsuccess?.();
	}
</script>

<div class="space-y-1">
	<Action
		action={sendContactSheetLink}
		label={m.actions_send_contact_sheet_send_contact_sheet_label()}
		modalTitle={actName
			? m.actions_send_contact_sheet_contact_sheet_title({ actName })
			: m.actions_send_contact_sheet_send_contact_sheet_title()}
		{variant}
		{size}
		{outline}
		class={className}
		onsuccess={handleSuccess}
		{...rest}
	>
		{#snippet form()}
			<input {...fields.entryId.as('hidden', entryId)} />
			<div class="space-y-3">
				<p class="text-sm text-fg-2">
					{m.actions_send_contact_sheet_sends_private_link_where_act_text()}
				</p>
				<FormField
					field={fields.email}
					label={m.actions_send_contact_sheet_where_should_link_go_label()}
				>
					<input
						{...fields.email.as('email')}
						bind:value={email}
						class="input w-full"
						placeholder={m.actions_send_contact_sheet_placeholder()}
					/>
				</FormField>
			</div>
		{/snippet}
	</Action>
	{#if issued}
		<p class="text-xs text-fg-2" data-testid="contact-sheet-link">
			{m.actions_send_contact_sheet_link_text()}:
			<code class="break-all select-all">{issued.url}</code>
			{#if !issued.sent}
				<span class="block">{m.actions_send_contact_sheet_link_2_text()}</span>
			{/if}
		</p>
	{/if}
</div>
