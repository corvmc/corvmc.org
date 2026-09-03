<script lang="ts">
	import { toast } from 'svelte-sonner';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { getPressKitEditor } from '$lib/remote/press-kit.remote';
	import { imageSrc } from '$lib/utils/images';
	import type { getBandLayout } from '$lib/remote/layout.remote';

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
		photoLimit
	}: {
		band: Awaited<ReturnType<typeof getBandLayout>>['band'];
		media: Item[];
		/** `null` means uncapped. Comes from the server, which also enforces it. */
		photoLimit: number | null;
	} = $props();

	const photos = $derived(media.filter((m) => m.slot === 'gallery'));
	const rider = $derived(media.find((m) => m.slot === 'rider'));
	const stagePlot = $derived(media.find((m) => m.slot === 'stage_plot'));
	const atLimit = $derived(photoLimit !== null && photos.length >= photoLimit);

	let busy = $state(false);

	// The upload endpoint is multipart, so it stays an API route rather than a
	// remote form. It is the same one the page editor uses, and it owns the tier
	// cap — the disabled button below is presentation, not the rule.
	async function upload(file: File, type: 'image' | 'rider' | 'stage_plot') {
		busy = true;
		try {
			const fd = new FormData();
			fd.set('file', file);
			fd.set('type', type);
			const res = await fetch(`/api/bands/${band.id}/media`, { method: 'POST', body: fd });
			if (!res.ok) {
				const body = (await res.json().catch(() => ({}))) as { message?: string };
				throw new Error(body.message || 'Upload failed');
			}
			await getPressKitEditor(band.slug).refresh();
			toast.success('Uploaded');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Upload failed');
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
			toast.success('Removed');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Could not remove that file');
		} finally {
			busy = false;
		}
	}

	function pick(type: 'image' | 'rider' | 'stage_plot', accept: string) {
		const el = document.createElement('input');
		el.type = 'file';
		el.accept = accept;
		el.onchange = () => {
			const file = el.files?.[0];
			if (file) void upload(file, type);
		};
		el.click();
	}

	const IMAGE_TYPES = 'image/jpeg,image/png,image/webp';
	const DOC_TYPES = `${IMAGE_TYPES},application/pdf`;
</script>

<InfoCard title="Download your kit">
	<p class="text-muted">
		A zip holding a one-page press kit, a plain-text version to paste into an email, your photos at
		full resolution, and your stage plot and rider. It carries a QR code back to your public page,
		so the shows list a venue sees stays current after you send it.
	</p>
	<div>
		<Button href="/api/bands/{band.id}/press-kit.zip" variant="primary" size="sm">
			Download press kit (.zip)
		</Button>
	</div>
</InfoCard>

<InfoCard title="Press photos">
	<p class="text-muted">
		A high-resolution shot a venue or a listings editor can print. Shown on your public page and
		included full-size in your downloadable kit.
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
					<Button
						type="button"
						variant="ghost"
						size="sm"
						disabled={busy}
						onclick={() => remove(photo.id)}
					>
						Remove
					</Button>
				</figure>
			{/each}
		</div>
	{:else}
		<p class="text-muted">No press photo yet. Your act's logo is set on the profile page.</p>
	{/if}

	<div class="flex flex-wrap items-center gap-3">
		<Button
			type="button"
			variant="default"
			outline
			size="sm"
			disabled={busy || atLimit}
			onclick={() => pick('image', IMAGE_TYPES)}
		>
			Add a photo
		</Button>
		{#if photoLimit !== null}
			<span class="text-muted text-sm">
				{photos.length} of {photoLimit}
				{#if atLimit}&middot; a band site lifts the limit{/if}
			</span>
		{:else}
			<span class="text-muted text-sm">Unlimited on your plan</span>
		{/if}
	</div>
</InfoCard>

<InfoCard title="Stage plot and tech rider">
	<p class="text-muted">
		Package only. A venue gets these by asking, which is also how you find out someone is
		interested.
	</p>
	<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
		{#each [{ item: stagePlot, type: 'stage_plot' as const, label: 'Stage plot' }, { item: rider, type: 'rider' as const, label: 'Tech rider' }] as row (row.type)}
			<div class="space-y-2">
				<h3 class="text-sm font-semibold">{row.label}</h3>
				{#if row.item}
					<p class="text-muted text-sm">{row.item.filename ?? 'Uploaded'}</p>
					<div class="flex gap-2">
						{#if row.item.url}
							<Button href={row.item.url} variant="ghost" size="sm" target="_blank">View</Button>
						{/if}
						<Button
							type="button"
							variant="ghost"
							size="sm"
							disabled={busy}
							onclick={() => remove(row.item!.id)}
						>
							Remove
						</Button>
					</div>
				{:else}
					<Button
						type="button"
						variant="default"
						outline
						size="sm"
						disabled={busy}
						onclick={() => pick(row.type, DOC_TYPES)}
					>
						Upload {row.label.toLowerCase()}
					</Button>
					<p class="text-muted text-xs">Image or PDF, up to 10MB.</p>
				{/if}
			</div>
		{/each}
	</div>
</InfoCard>
