<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/**
	 * "The date is wrong." An act credited on somebody else's listing had only
	 * accept and decline, so a bad listing and no listing were the only two
	 * outcomes available to it (#564).
	 *
	 * Goes to CorvMC staff, who can edit every listing — see
	 * `requestListingCorrectionForm` for why not to the owner directly.
	 */
	import { IconMessageReport } from '@tabler/icons-svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import { requestListingCorrectionForm } from '#lib/remote/band-events.remote.js';

	let { slug, eventId }: { slug: string; eventId: string } = $props();

	const action = $derived(requestListingCorrectionForm.for(eventId));
</script>

<Action
	{action}
	label={m.band_slug_events_request_correction_request_correction()}
	iconOnly
	modalTitle={m.band_slug_events_request_correction_request_correction()}
	submitLabel={m.band_slug_events_request_correction_submit_label()}
	successToast={m.band_slug_events_request_correction_success_toast()}
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
				{m.band_slug_events_request_correction_goes_corvmc_staff_who_ca()}
			</p>
			<FormField
				field={fields.body}
				label={m.band_slug_events_request_correction_what_needs_changing()}
				description={m.band_slug_events_request_correction_description()}
			/>
		</div>
	{/snippet}
</Action>
