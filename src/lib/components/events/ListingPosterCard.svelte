<script lang="ts">
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import { toast } from 'svelte-sonner';
	import { responseErrorMessage } from '$lib/api';
	import { imageSrc } from '$lib/utils/images';
	import { useTemplateFlyerAsPoster } from '$lib/remote/productions.remote';

	/**
	 * A listing's poster: upload one, or draw the template flyer as one. Both are
	 * listing writes (`requireListingWriter`), so they work for any source.
	 * `onchange` lets the page refresh whichever query it renders from.
	 */
	interface Props {
		eventId: string;
		posterUrl: string | null;
		cancelled: boolean;
		onchange: () => void;
	}

	let { eventId, posterUrl, cancelled, onchange }: Props = $props();

	async function upload(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		const formData = new FormData();
		formData.append('poster', file);
		try {
			const res = await fetch(`/api/events/${eventId}/poster`, { method: 'POST', body: formData });
			if (!res.ok) throw new Error(await responseErrorMessage(res, 'Upload failed'));
			toast.success('Poster updated');
			onchange();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to upload poster');
		}
	}
</script>

<InfoCard title="Poster">
	{#if posterUrl}
		{@const poster = imageSrc(posterUrl, 'poster')}
		<img
			src={poster.src}
			srcset={poster.srcset}
			sizes={poster.sizes}
			alt="Event poster"
			class="max-h-64 rounded object-contain"
		/>
	{:else}
		<p class="text-muted">No poster uploaded</p>
	{/if}

	{#if !cancelled}
		<div class="mt-3 flex flex-wrap items-center gap-2">
			<!-- A bare file input, not a FormField: the upload posts on change to an
			     endpoint, with no form around it to submit. -->
			<input
				type="file"
				accept="image/jpeg,image/png,image/webp"
				aria-label="Upload a poster"
				onchange={upload}
				class="file-input file-input-sm"
			/>
			<!-- The fallback when no art arrives: a real poster, so it passes the publish gate. -->
			<Action
				action={useTemplateFlyerAsPoster}
				label="Use the template flyer"
				variant="ghost"
				size="sm"
				modalTitle="Use the template flyer?"
				submitLabel="Make the poster"
				successToast="Poster updated"
				onsuccess={onchange}
			>
				{#snippet form()}
					<input type="hidden" name="eventId" value={eventId} />
					<p class="text-sm">
						A flyer is drawn from the title, date, doors, venue, bill and price, and it replaces the
						current poster. It is a snapshot: after editing the event, run this again.
					</p>
				{/snippet}
			</Action>
		</div>
	{/if}
</InfoCard>
