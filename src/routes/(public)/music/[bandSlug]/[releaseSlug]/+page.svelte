<script lang="ts">
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import TrackList from '$lib/components/audio/TrackList.svelte';
	import BuyPanel from './BuyPanel.svelte';
	import { getPublicRelease } from '$lib/remote/music.remote';
	import { releaseKindLabels } from '$lib/config';
	import { formatTrackSummary } from '$lib/utils/audio';
	import { formatDateYear } from '$lib/utils/format';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { IconDisc } from '@tabler/icons-svelte';

	const { release, band, tracks, purchasable, viewerEmail } = $derived(
		await getPublicRelease({
			bandSlug: page.params.bandSlug!,
			releaseSlug: page.params.releaseSlug!
		})
	);

	const totalMs = $derived(tracks.reduce((sum, t) => sum + t.durationMs, 0));
</script>

<svelte:head>
	<title>{release.title} — {band.name}</title>
	<meta
		name="description"
		content="{release.title} by {band.name}, on the Corvallis Music Collective."
	/>
</svelte:head>

<div class="mx-auto max-w-3xl space-y-6 p-6">
	<div class="flex flex-wrap items-start gap-6">
		{#if release.coverUrl}
			<img src={release.coverUrl} alt="" class="size-40 shrink-0 rounded object-cover" />
		{:else}
			<div class="grid size-40 shrink-0 place-items-center rounded bg-base-200 text-subtle">
				<IconDisc size={48} />
			</div>
		{/if}

		<div class="min-w-0 flex-1">
			<h1 class="text-3xl font-semibold">{release.title}</h1>
			<p class="text-lg">
				<a class="link" href={resolve(`/directory/bands/${band.slug}`)}>{band.name}</a>
			</p>
			<p class="text-muted">
				<Badge size="sm">{releaseKindLabels[release.kind]}</Badge>
				{formatTrackSummary(tracks.length, totalMs)}
				{#if release.releasedAt}
					· {formatDateYear(release.releasedAt)}
				{/if}
			</p>
		</div>
	</div>

	{#if release.description}
		<p class="whitespace-pre-line">{release.description}</p>
	{/if}

	<Card>
		<CardBody>
			<!-- Full tracks, free, to anyone. What is being sold is the file you
			     keep — that is the bargain that gets local music heard. -->
			<TrackList {tracks} />
		</CardBody>
	</Card>

	{#if purchasable}
		<BuyPanel
			bandSlug={band.slug}
			bandName={band.name}
			releaseSlug={release.slug}
			priceMinCents={release.priceMinCents}
			allowPayMore={release.allowPayMore}
			{viewerEmail}
		/>
	{:else}
		<!-- A priced release whose band has not finished Stripe. Saying so beats
		     a Buy button that 409s. -->
		<Alert type="info">
			{band.name} hasn't finished setting up payouts, so this release can't be bought yet. You can still
			listen to all of it here.
		</Alert>
	{/if}
</div>
