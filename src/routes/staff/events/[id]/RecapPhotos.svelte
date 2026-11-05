<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { IconPencil, IconTrash } from '@tabler/icons-svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import {
		uploadEventPhotos,
		removeEventPhoto,
		describeEventPhoto
	} from '#lib/remote/event-photos.remote.js';
	import { imageSrc } from '#lib/utils/images.js';

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
<InfoCard
	title={m.staff_events_id_recap_photos_recap_photos()}
	state="{photos.length} of {recap.maxPhotos}"
>
	{#if !recap.closedReason && !full}
		<Form
			remote={uploadEventPhotos}
			enctype="multipart/form-data"
			successToast={m.staff_events_id_recap_photos_photos_added()}
		>
			<input {...uploadFields.eventId.as('hidden', eventId)} />
			<FormField
				field={uploadFields.photos}
				label={m.staff_events_id_recap_photos_add_photos()}
				description={m.staff_events_id_recap_photos_jpeg_png_webp_up_10({
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
			<SubmitButton label={m.staff_events_id_recap_photos_upload()} />
		</Form>
	{/if}

	{#if photos.length === 0}
		<EmptyState
			title={m.staff_events_id_recap_photos_no_photos_yet()}
			description={m.staff_events_id_recap_photos_photos_from_night_go_public()}
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
						alt={photo.altText ?? m.staff_events_id_recap_photos_alt({ eventTitle })}
						class="aspect-square w-full rounded object-cover"
						loading="lazy"
					/>
					{#if photo.caption}
						<p class="line-clamp-2 text-sm">{photo.caption}</p>
					{/if}
					<div class="flex items-center gap-1">
						{#if !photo.altText}
							<span class="text-muted text-xs">{m.staff_events_id_recap_photos_no_alt_text()}</span>
						{/if}
						<span class="grow"></span>
						<Action
							action={describeEventPhoto.for(photo.attachmentId)}
							iconOnly
							variant="ghost"
							size="sm"
							label={m.staff_events_id_recap_photos_describe()}
							modalTitle={m.staff_events_id_recap_photos_describe_photo()}
							submitLabel={m.staff_save()}
							successToast={m.staff_saved()}
						>
							{#snippet icon()}<IconPencil size={16} />{/snippet}
							{#snippet form()}
								{@const fields = describeEventPhoto.for(photo.attachmentId).fields}
								<div class="space-y-4">
									<input {...fields.eventId.as('hidden', eventId)} />
									<input {...fields.attachmentId.as('hidden', photo.attachmentId)} />
									<FormField
										field={fields.altText}
										label={m.staff_events_id_recap_photos_alt_text()}
										description={m.staff_events_id_recap_photos_what_photo_shows_someone_who()}
										value={photo.altText ?? ''}
									/>
									<FormField
										field={fields.caption}
										label={m.staff_events_id_recap_photos_caption()}
										value={photo.caption ?? ''}
									/>
								</div>
							{/snippet}
						</Action>
						<Action
							action={removeEventPhoto.for(photo.attachmentId)}
							iconOnly
							variant="ghost"
							size="sm"
							label={m.staff_remove()}
							modalTitle={m.staff_events_id_recap_photos_remove_photo()}
							submitLabel={m.staff_remove()}
							submitVariant="error"
							successToast={m.staff_events_id_recap_photos_photo_removed()}
						>
							{#snippet icon()}<IconTrash size={16} />{/snippet}
							{#snippet form()}
								{@const fields = removeEventPhoto.for(photo.attachmentId).fields}
								<input {...fields.eventId.as('hidden', eventId)} />
								<input {...fields.attachmentId.as('hidden', photo.attachmentId)} />
								<p>{m.staff_events_id_recap_photos_take_photo_off_public_event()}</p>
							{/snippet}
						</Action>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</InfoCard>
