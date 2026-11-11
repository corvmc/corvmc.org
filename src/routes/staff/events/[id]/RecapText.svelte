<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import { saveEventRecapText } from '#lib/remote/event-photos.remote.js';

	let {
		eventId,
		text,
		closedReason
	}: { eventId: string; text: string | null; closedReason: string | null } = $props();

	const fields = saveEventRecapText.fields;
</script>

<!-- The written recap (#1401): shown above the photos on the public event page. -->
<InfoCard title={m.staff_events_id_recap_text_title()} state={text ? 'Published' : 'Not written'}>
	{#if closedReason}
		<p class="text-muted text-sm">
			{m.staff_events_id_recap_text_clearing_existing_recap_still_wor_text({ closedReason })}
		</p>
	{/if}
	<Form remote={saveEventRecapText} successToast={m.staff_events_id_recap_text_success_toast()}>
		<input {...fields.eventId.as('hidden', eventId)} />
		<FormField
			field={fields.recapText}
			label={m.staff_events_id_recap_text_paragraph_about_night_label()}
			description={m.staff_events_id_recap_text_description_body()}
		>
			{#snippet input(id)}
				<textarea
					{...fields.recapText.as('text', text ?? '')}
					{id}
					class="textarea w-full"
					rows="6"
					maxlength="5000"></textarea>
			{/snippet}
		</FormField>
		<SubmitButton label={m.staff_events_id_recap_text_save_recap_label()} />
	</Form>
</InfoCard>
