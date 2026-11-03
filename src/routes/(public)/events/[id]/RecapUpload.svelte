<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import { uploadEventPhotos } from '$lib/remote/event-photos.remote';

	let {
		eventId,
		recap
	}: {
		eventId: string;
		recap: { closedReason: string | null; remaining: number; maxPerUpload: number };
	} = $props();

	const uploadFields = uploadEventPhotos.fields;
</script>

<!-- A volunteer photographer's way in (#1398): upload only. Captions, alt text
     and removal stay on the staff event page. -->
<InfoCard title={m.public_events_id_recap_upload_title()} state="{recap.remaining} left">
	{#if recap.closedReason}
		<p class="text-muted">{recap.closedReason}</p>
	{:else if recap.remaining === 0}
		<p class="text-muted">{m.public_events_id_recap_upload_event_s_recap_full()}</p>
	{:else}
		<Form
			remote={uploadEventPhotos}
			enctype="multipart/form-data"
			successToast={m.public_events_id_recap_upload_success_toast()}
		>
			<input {...uploadFields.eventId.as('hidden', eventId)} />
			<FormField
				field={uploadFields.photos}
				label={m.public_photos()}
				description={m.public_events_id_recap_upload_description({
					maxPerUpload: recap.maxPerUpload
				})}
			>
				{#snippet input(id)}
					<input
						{...uploadFields.photos.as('file multiple')}
						{id}
						accept="image/jpeg,image/png,image/webp"
						class="file-input w-full"
					/>
				{/snippet}
			</FormField>
			<SubmitButton label={m.public_events_id_recap_upload_upload()} />
		</Form>
	{/if}
</InfoCard>
