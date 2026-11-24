<script lang="ts">
	import { m as msg } from '#lib/paraglide/messages.js';
	import { toast } from 'svelte-sonner';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import { getPressKitEditor } from '#lib/remote/press-kit.remote.js';
	import { imageSrc } from '#lib/utils/images.js';
	import type { getBandLayout } from '#lib/remote/layout.remote.js';

	type Item = {
		id: string;
		url: string | null;
		slot: string;
		filename: string | null;
		altText: string | null;
		caption: string | null;
	};

	let {
		band,
		media,
		photoLimit,
		edits = $bindable(),
		canEdit = false
	}: {
		band: Awaited<ReturnType<typeof getBandLayout>>['band'];
		media: Item[];
		/** `null` means uncapped. Comes from the server, which also enforces it. */
		photoLimit: number | null;
		/**
		 * Alt text and captions typed since the last save, by attachment id. The
		 * press kit form posts them with its own Save; a photo not in here keeps
		 * what it has.
		 */
		edits: Record<string, { altText: string; caption: string }>;
		/** Owner or admin; the upload, media and zip routes are owner/admin guarded. */
		canEdit?: boolean;
	} = $props();

	const photos = $derived(media.filter((m) => m.slot === 'gallery'));
	const atLimit = $derived(photoLimit !== null && photos.length >= photoLimit);

	let busy = $state(false);

	function edited(photo: Item) {
		return edits[photo.id] ?? { altText: photo.altText ?? '', caption: photo.caption ?? '' };
	}

	// The upload endpoint is multipart, so it stays an API route rather than a
	// remote form. It is the same one the page editor uses, and it owns the tier
	// cap — the disabled button below is presentation, not the rule.
	async function upload(file: File) {
		busy = true;
		try {
			const fd = new FormData();
			fd.set('file', file);
			fd.set('type', 'image');
			const res = await fetch(`/api/bands/${band.id}/media`, { method: 'POST', body: fd });
			if (!res.ok) {
				const body = (await res.json().catch(() => ({}))) as { message?: string };
				throw new Error(body.message || 'Upload failed');
			}
			await getPressKitEditor(band.slug).refresh();
			toast.success(msg.band_uploaded_toast());
		} catch (e) {
			toast.error(
				e instanceof Error ? e.message : msg.band_slug_press_kit_press_photos_upload_failed_toast()
			);
		} finally {
			busy = false;
		}
	}

	async function remove(attachmentId: string) {
		busy = true;
		try {
			const res = await fetch(`/api/bands/${band.id}/media?mediaId=${attachmentId}`, {
				method: 'DELETE'
			});
			if (!res.ok) throw new Error('Could not remove that file');
			await getPressKitEditor(band.slug).refresh();
			toast.success(msg.band_removed_toast());
		} catch (e) {
			toast.error(
				e instanceof Error
					? e.message
					: msg.band_slug_press_kit_press_photos_could_not_remove_file_toast()
			);
		} finally {
			busy = false;
		}
	}

	function pick() {
		const el = document.createElement('input');
		el.type = 'file';
		el.accept = IMAGE_TYPES;
		el.onchange = () => {
			const file = el.files?.[0];
			if (file) void upload(file);
		};
		el.click();
	}

	const IMAGE_TYPES = 'image/jpeg,image/png,image/webp';
</script>

<div id="press-photos" class="scroll-mt-24">
	<InfoCard title={msg.band_slug_press_kit_press_photos_press_photos_title()}>
		<p class="text-muted">
			{msg.band_slug_press_kit_press_photos_high_resolution_shot_venue_text()}
		</p>
		{#if photos.length > 0}
			<div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
				{#each photos as photo (photo.id)}
					<figure class="space-y-2">
						{#if photo.url}
							{@const shot = imageSrc(photo.url, 'gallery')}
							<img
								src={shot.src}
								srcset={shot.srcset}
								sizes={shot.sizes}
								alt={photo.altText ?? ''}
								class="aspect-square w-full rounded object-cover"
							/>
						{/if}
						{#if canEdit}
							<FormField
								type="text"
								label={msg.band_slug_press_kit_press_photos_alt_text_label()}
								maxlength={300}
								bind:value={
									() => edited(photo).altText,
									(v) => (edits[photo.id] = { ...edited(photo), altText: v })
								}
								description={msg.band_slug_press_kit_press_photos_description_body()}
							/>
							<FormField
								type="text"
								label={msg.band_slug_press_kit_press_photos_caption_label()}
								maxlength={300}
								bind:value={
									() => edited(photo).caption,
									(v) => (edits[photo.id] = { ...edited(photo), caption: v })
								}
							/>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								disabled={busy}
								onclick={() => remove(photo.id)}
							>
								{msg.band_remove_label()}
							</Button>
						{:else if photo.caption}
							<figcaption class="text-sm">{photo.caption}</figcaption>
						{/if}
					</figure>
				{/each}
			</div>
		{:else}
			<p class="text-muted">
				{msg.band_slug_press_kit_press_photos_no_press_photo_yet_band_text()}
			</p>
		{/if}

		{#if canEdit}
			<div class="flex flex-wrap items-center gap-3">
				<Button
					type="button"
					variant="default"
					outline
					size="sm"
					disabled={busy || atLimit}
					onclick={() => pick()}
				>
					{msg.band_add_photo_label()}
				</Button>
				{#if photoLimit !== null}
					<span class="text-muted text-sm">
						{msg.band_slug_press_kit_press_photos_text({ length: photos.length, photoLimit })}
						{#if atLimit}{msg.band_slug_press_kit_press_photos_band_site_lifts_limit_text()}{/if}
					</span>
				{:else}
					<span class="text-muted text-sm"
						>{msg.band_slug_press_kit_press_photos_unlimited_plan_text()}</span
					>
				{/if}
			</div>
		{/if}
	</InfoCard>
</div>
