<script lang="ts">
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import { sendContactSheetLink } from '$lib/remote/contact-sheet.remote';

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
	label="Send contact sheet"
	modalTitle={actName ? `Contact sheet for ${actName}` : 'Send contact sheet'}
	successToast="Link sent"
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
				Sends a private link where the act fills in its own details. Preferred over typing them in
				on their behalf — what we hold is then what they chose to give us.
			</p>
			<FormField field={fields.email} label="Where should the link go?">
				<input
					{...fields.email.as('email')}
					bind:value={email}
					class="input w-full"
					placeholder="booking@theact.com"
				/>
			</FormField>
		</div>
	{/snippet}
</Action>
