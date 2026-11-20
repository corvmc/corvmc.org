<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '#lib/components/ui/Action.svelte';
	import FileUpload from '#lib/components/ui/Form/FileUpload.svelte';
	import { toast } from 'svelte-sonner';
	import { responseErrorMessage } from '#lib/api.js';
	import { imageSrc } from '#lib/utils/images.js';
	import { useTemplateFlyerAsPoster } from '#lib/remote/productions.remote.js';
	import { printEventPoster } from '#lib/remote/event-poster.remote.js';
	import Button from '#lib/components/ui/Button.svelte';

	/**
	 * A listing's poster, portrait, in the event page's sidebar (#3270). With a
	 * poster: Clear and Download. Without one: Upload poster and the template
	 * flyer, which is offered only over an empty slot (#3265). All are listing
	 * writes (`requireListingWriter`), so they work for any source.
	 */
	interface Props {
		eventId: string;
		posterUrl: string | null;
		posterSource: 'none' | 'generated' | 'uploaded';
		cancelled: boolean;
		/** Staff may still replace a cancelled listing's poster; the flyer stays off. */
		uploadWhileCancelled?: boolean;
		onchange: () => void;
	}

	let {
		eventId,
		posterUrl,
		posterSource,
		cancelled,
		uploadWhileCancelled = false,
		onchange
	}: Props = $props();

	const editable = $derived(!cancelled || uploadWhileCancelled);

	async function upload(file: File) {
		const formData = new FormData();
		formData.append('poster', file);
		const res = await fetch(`/api/events/${eventId}/poster`, { method: 'POST', body: formData });
		if (!res.ok) throw new Error(await responseErrorMessage(res, 'Upload failed'));
		toast.success(m.events_listing_poster_card_toast());
		onchange();
	}

	async function clear() {
		const res = await fetch(`/api/events/${eventId}/poster`, { method: 'DELETE' });
		if (!res.ok) throw new Error(await responseErrorMessage(res, 'Clear failed'));
		onchange();
	}

	let printing = $state(false);

	/** Render the Letter PDF on the server, then hand it to the browser as a download. */
	async function downloadPrintPoster() {
		printing = true;
		try {
			const { file, filename } = await printEventPoster({ eventId });
			const a = document.createElement('a');
			a.href = file;
			a.download = filename;
			a.click();
		} catch (e) {
			const err = e as { body?: { message?: string } };
			toast.error(err.body?.message ?? m.events_listing_poster_card_print_failed_toast());
		} finally {
			printing = false;
		}
	}
</script>

<section class="flex flex-col gap-2" aria-label={m.events_listing_poster_card_poster_label()}>
	{#if posterUrl}
		{@const poster = imageSrc(posterUrl, 'poster')}
		<img
			src={poster.src}
			srcset={poster.srcset}
			sizes={poster.sizes}
			alt={m.events_listing_poster_card_alt_text()}
			class="aspect-[2/3] w-full rounded-box bg-base-200 object-contain"
		/>
	{:else}
		<div
			class="grid aspect-[2/3] w-full place-content-center rounded-box border border-dashed border-base-300 text-center text-muted"
		>
			{m.events_listing_poster_card_no_poster_uploaded_text()}
		</div>
	{/if}

	{#if editable}
		<div class="flex flex-wrap items-center gap-2" data-testid="poster-actions">
			{#if posterUrl}
				<Action
					action={clear}
					label={m.events_listing_poster_card_clear_label()}
					confirm={m.events_listing_poster_card_clear_body()}
					successToast={m.events_listing_poster_card_cleared_toast()}
					variant="ghost"
					size="sm"
				/>
				{#if posterSource === 'uploaded'}
					<!-- The uploaded image above a details footer, as a Letter PDF; nothing is stored. -->
					<Button variant="ghost" size="sm" disabled={printing} onclick={downloadPrintPoster}>
						{m.events_listing_poster_card_download_label()}
					</Button>
				{:else}
					<!-- A drawn flyer already carries the details, so it is the print file. -->
					<Button variant="ghost" size="sm" href={posterUrl} download>
						{m.events_listing_poster_card_download_label()}
					</Button>
				{/if}
			{:else}
				<FileUpload
					{upload}
					accept="image/jpeg,image/png,image/webp"
					showPreview={false}
					emptyLabel={m.events_listing_poster_card_upload_poster_title()}
					aria-label={m.events_listing_poster_card_upload_poster_label()}
				/>
				{#if !cancelled}
					<!-- The fallback when no art arrives: a real poster, so it passes the publish gate. -->
					<Action
						action={useTemplateFlyerAsPoster}
						label={m.events_listing_poster_card_label()}
						variant="ghost"
						size="sm"
						modalTitle={m.events_listing_poster_card_modal_title()}
						submitLabel={m.events_listing_poster_card_submit_label()}
						successToast={m.events_listing_poster_card_toast()}
						onsuccess={onchange}
					>
						{#snippet form()}
							<input {...useTemplateFlyerAsPoster.fields.eventId.as('hidden', eventId)} />
							<p class="text-sm">
								{m.events_listing_poster_card_flyer_drawn_from_title_date_text()}
							</p>
						{/snippet}
					</Action>
				{/if}
			{/if}
		</div>
	{/if}
</section>
