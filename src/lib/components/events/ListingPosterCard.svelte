<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import FileUpload from '#lib/components/ui/Form/FileUpload.svelte';
	import { toast } from 'svelte-sonner';
	import { responseErrorMessage } from '#lib/api.js';
	import { imageSrc } from '#lib/utils/images.js';
	import { useTemplateFlyerAsPoster } from '#lib/remote/productions.remote.js';

	/**
	 * A listing's poster: upload one, or draw the template flyer as one. Both are
	 * listing writes (`requireListingWriter`), so they work for any source.
	 * `onchange` lets the page refresh whichever query it renders from.
	 */
	interface Props {
		eventId: string;
		posterUrl: string | null;
		cancelled: boolean;
		/** Staff may still replace a cancelled listing's poster; the flyer stays off. */
		uploadWhileCancelled?: boolean;
		onchange: () => void;
	}

	let { eventId, posterUrl, cancelled, uploadWhileCancelled = false, onchange }: Props = $props();

	async function upload(file: File) {
		const formData = new FormData();
		formData.append('poster', file);
		const res = await fetch(`/api/events/${eventId}/poster`, { method: 'POST', body: formData });
		if (!res.ok) throw new Error(await responseErrorMessage(res, 'Upload failed'));
		toast.success(m.events_listing_poster_card_toast());
		onchange();
	}
</script>

<InfoCard title={m.events_listing_poster_card_title()}>
	{#if posterUrl}
		{@const poster = imageSrc(posterUrl, 'poster')}
		<img
			src={poster.src}
			srcset={poster.srcset}
			sizes={poster.sizes}
			alt={m.events_listing_poster_card_alt()}
			class="max-h-64 rounded object-contain"
		/>
	{:else}
		<p class="text-muted">{m.events_listing_poster_card_no_poster_uploaded()}</p>
	{/if}

	{#if !cancelled || uploadWhileCancelled}
		<div class="mt-3 flex flex-wrap items-center gap-2">
			<!-- The poster is drawn above at its own size, so no preview here. -->
			<FileUpload
				{upload}
				accept="image/jpeg,image/png,image/webp"
				showPreview={false}
				emptyLabel={posterUrl
					? m.events_listing_poster_card_replace_poster()
					: m.events_listing_poster_card_upload_poster()}
				aria-label={m.events_listing_poster_card_upload_poster()}
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
						<input type="hidden" name="eventId" value={eventId} />
						<p class="text-sm">
							{m.events_listing_poster_card_flyer_drawn_from_title_date()}
						</p>
					{/snippet}
				</Action>
			{/if}
		</div>
	{/if}
</InfoCard>
