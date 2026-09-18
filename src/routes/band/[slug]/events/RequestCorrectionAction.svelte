<script lang="ts">
	/**
	 * "The date is wrong." An act credited on somebody else's listing had only
	 * accept and decline, so a bad listing and no listing were the only two
	 * outcomes available to it (#564).
	 *
	 * Goes to CorvMC staff, who can edit every listing — see
	 * `requestListingCorrectionForm` for why not to the owner directly.
	 */
	import { IconMessageReport } from '@tabler/icons-svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import { requestListingCorrectionForm } from '$lib/remote/band-events.remote';

	let { slug, eventId }: { slug: string; eventId: string } = $props();

	const action = $derived(requestListingCorrectionForm.for(eventId));
</script>

<Action
	{action}
	label="Request a correction"
	iconOnly
	modalTitle="Request a correction"
	submitLabel="Send to staff"
	successToast="Sent — staff will pick it up"
	variant="ghost"
	size="xs"
>
	{#snippet icon()}<IconMessageReport size={16} />{/snippet}
	{#snippet form()}
		{@const fields = requestListingCorrectionForm.for(eventId).fields}
		<div class="space-y-3">
			<input {...fields.slug.as('hidden', slug)} />
			<input {...fields.eventId.as('hidden', eventId)} />
			<p class="text-muted">
				This goes to CorvMC staff, who can edit any listing. They'll reply in your Messages.
			</p>
			<FormField
				field={fields.body}
				label="What needs changing?"
				description="The date, the spelling of your name, the set times — whatever is wrong."
			/>
		</div>
	{/snippet}
</Action>
