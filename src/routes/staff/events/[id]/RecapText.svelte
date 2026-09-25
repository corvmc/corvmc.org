<script lang="ts">
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import { saveEventRecapText } from '$lib/remote/event-photos.remote';

	let {
		eventId,
		text,
		closedReason
	}: { eventId: string; text: string | null; closedReason: string | null } = $props();

	const fields = saveEventRecapText.fields;
</script>

<!-- The written recap (#1401): shown above the photos on the public event page. -->
<InfoCard title="Recap" state={text ? 'Published' : 'Not written'}>
	{#if closedReason}
		<p class="text-muted text-sm">{closedReason} Clearing an existing recap still works.</p>
	{/if}
	<Form remote={saveEventRecapText} successToast="Recap saved">
		<input {...fields.eventId.as('hidden', eventId)} />
		<FormField
			field={fields.recapText}
			label="A paragraph about the night"
			description="Markdown. It appears above the photos on the public event page, and the first lines show under Recent recaps on /events. Leave it blank to remove it."
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
		<SubmitButton label="Save recap" />
	</Form>
</InfoCard>
