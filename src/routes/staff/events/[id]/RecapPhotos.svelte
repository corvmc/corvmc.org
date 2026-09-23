<script lang="ts">
	import { IconPencil, IconTrash } from '@tabler/icons-svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import {
		uploadEventPhotos,
		removeEventPhoto,
		describeEventPhoto
	} from '$lib/remote/event-photos.remote';
	import { imageSrc } from '$lib/utils/images';

	type Photo = {
		attachmentId: string;
		url: string | null;
		filename: string | null;
		altText: string | null;
		caption: string | null;
	};

	let {
		eventId,
		eventTitle,
		recap
	}: {
		eventId: string;
		eventTitle: string;
		recap: {
			photos: Photo[];
			closedReason: string | null;
			maxPhotos: number;
			maxPerUpload: number;
		};
	} = $props();

	const photos = $derived(recap.photos);
	const full = $derived(photos.length >= recap.maxPhotos);
	const uploadFields = uploadEventPhotos.fields;
</script>

<!-- Recap photos (docs/specs/event-recaps-spec.md): shown publicly on the event
     page as soon as they are added. -->
<InfoCard title="Recap photos" state="{photos.length} of {recap.maxPhotos}">
	{#if !recap.closedReason && !full}
		<Form remote={uploadEventPhotos} enctype="multipart/form-data" successToast="Photos added">
			<input {...uploadFields.eventId.as('hidden', eventId)} />
			<FormField
				field={uploadFields.photos}
				label="Add photos"
				description="JPEG, PNG or WebP, up to 10 MB each and {recap.maxPerUpload} at a time. They appear on the public event page straight away."
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

	{#if photos.length === 0}
		<EmptyState
			title="No photos yet"
			description="Photos from the night go on the public event page."
		/>
	{:else}
		<ul class="grid grid-cols-2 gap-3 sm:grid-cols-3">
			{#each photos as photo (photo.attachmentId)}
				{@const shot = imageSrc(photo.url, 'gallery')}
				<li class="space-y-1">
					<img
						src={shot.src}
						srcset={shot.srcset}
						sizes={shot.sizes}
						alt={photo.altText ?? `Photo from ${eventTitle}`}
						class="aspect-square w-full rounded object-cover"
						loading="lazy"
					/>
					{#if photo.caption}
						<p class="line-clamp-2 text-sm">{photo.caption}</p>
					{/if}
					<div class="flex items-center gap-1">
						{#if !photo.altText}
							<span class="text-muted text-xs">No alt text</span>
						{/if}
						<span class="grow"></span>
						<Action
							action={describeEventPhoto.for(photo.attachmentId)}
							iconOnly
							variant="ghost"
							size="sm"
							label="Describe"
							modalTitle="Describe photo"
							submitLabel="Save"
							successToast="Saved"
						>
							{#snippet icon()}<IconPencil size={16} />{/snippet}
							{#snippet form()}
								{@const fields = describeEventPhoto.for(photo.attachmentId).fields}
								<div class="space-y-4">
									<input {...fields.eventId.as('hidden', eventId)} />
									<input {...fields.attachmentId.as('hidden', photo.attachmentId)} />
									<FormField
										field={fields.altText}
										label="Alt text"
										description="What the photo shows, for someone who cannot see it."
										value={photo.altText ?? ''}
									/>
									<FormField field={fields.caption} label="Caption" value={photo.caption ?? ''} />
								</div>
							{/snippet}
						</Action>
						<Action
							action={removeEventPhoto.for(photo.attachmentId)}
							iconOnly
							variant="ghost"
							size="sm"
							label="Remove"
							modalTitle="Remove photo"
							submitLabel="Remove"
							submitVariant="error"
							successToast="Photo removed"
						>
							{#snippet icon()}<IconTrash size={16} />{/snippet}
							{#snippet form()}
								{@const fields = removeEventPhoto.for(photo.attachmentId).fields}
								<input {...fields.eventId.as('hidden', eventId)} />
								<input {...fields.attachmentId.as('hidden', photo.attachmentId)} />
								<p>Take this photo off the public event page?</p>
							{/snippet}
						</Action>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</InfoCard>
