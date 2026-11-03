<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import { sendContactSheetLink } from '#lib/remote/contact-sheet.remote.js';

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
	let email = $state(defaultEmail);
</script>

<Action
	action={sendContactSheetLink}
	label={m.actions_send_contact_sheet_send_contact_sheet()}
	modalTitle={actName
		? m.actions_send_contact_sheet_contact_sheet({ actName })
		: m.actions_send_contact_sheet_send_contact_sheet()}
	successToast={m.actions_send_contact_sheet_success_toast()}
	{variant}
	{size}
	{outline}
	class={className}
	{onsuccess}
	{...rest}
>
	{#snippet form()}
		<input {...fields.entryId.as('hidden', entryId)} />
		<div class="space-y-3">
			<p class="text-sm text-fg-2">
				{m.actions_send_contact_sheet_sends_private_link_where_act()}
			</p>
			<FormField field={fields.email} label={m.actions_send_contact_sheet_where_should_link_go()}>
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
