<script lang="ts">
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
<InfoCard title="Add recap photos" state="{recap.remaining} left">
	{#if recap.closedReason}
		<p class="text-muted">{recap.closedReason}</p>
	{:else if recap.remaining === 0}
		<p class="text-muted">This event's recap is full.</p>
	{:else}
		<Form remote={uploadEventPhotos} enctype="multipart/form-data" successToast="Photos added">
			<input {...uploadFields.eventId.as('hidden', eventId)} />
			<FormField
				field={uploadFields.photos}
				label="Photos"
				description="JPEG, PNG or WebP, up to 10 MB each and {recap.maxPerUpload} at a time. They appear on this page straight away."
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
			<SubmitButton label="Upload" />
		</Form>
	{/if}
</InfoCard>
