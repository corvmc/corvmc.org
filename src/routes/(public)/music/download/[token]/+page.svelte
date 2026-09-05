<script lang="ts">
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import { getDownload } from '$lib/remote/music.remote';
	import { formatTrackLength } from '$lib/utils/audio';
	import Button from '$lib/components/ui/Button.svelte';
	import { IconDownload } from '@tabler/icons-svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';

	const download = $derived(await getDownload(page.params.token!));

	// The purchase is flipped to `paid` by `checkout.session.completed`, not by
	// the payment itself, and the buyer now pays on our own page — so they can
	// land here in the same second they confirm, before the webhook has been
	// delivered. Poll, bounded: twenty seconds is longer than the webhook has
	// ever taken, and past that the buyer is better served by the receipt email,
	// which carries this same link and is sent from the fulfillment path.
	const RETRY_LIMIT = 10;
	const RETRY_MS = 2000;
	let attempts = $state(0);

	$effect(() => {
		if (download.status !== 'pending' || attempts >= RETRY_LIMIT) return;

		const timer = setTimeout(() => {
			attempts += 1;
			void getDownload(page.params.token!).refresh();
		}, RETRY_MS);

		return () => clearTimeout(timer);
	});
</script>

<svelte:head>
	<title
		>{download.status === 'ready' ? download.releaseTitle : 'Your download'} — your download</title
	>
	<!-- Never indexed: the URL in the address bar IS the entitlement. -->
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="mx-auto max-w-2xl space-y-6 p-6">
	{#if download.status === 'pending'}
		<h1 class="text-3xl font-semibold">Confirming your payment…</h1>
		<Alert type={attempts >= RETRY_LIMIT ? 'warning' : 'info'}>
			{attempts >= RETRY_LIMIT
				? "We haven't had confirmation from our payment processor yet. Nothing has gone wrong with your order — the download link is emailed to you as soon as it lands, and this page will work then too."
				: 'This usually takes a couple of seconds. Your files appear here as soon as it clears.'}
		</Alert>
	{:else}
		<div>
			<h1 class="text-3xl font-semibold">{download.releaseTitle}</h1>
			<p class="text-muted">{download.bandName}</p>
		</div>

		<!-- Said plainly, because for a buyer with no account this page's address is
		     the only handle they have on what they bought. The receipt email carries
		     the same link, which is the copy that survives closing the tab. -->
		<Alert type="info">
			Bookmark this page — it's how you get these files again later. We've emailed you the link too.
		</Alert>

		<Card>
			<CardBody>
				<ul class="divide-y divide-base-300">
					{#each download.tracks as track (track.id)}
						<li class="flex items-center gap-3 py-2">
							<span class="w-6 text-right text-subtle tabular-nums">{track.trackNumber}</span>
							<span class="min-w-0 flex-1 truncate">{track.title}</span>
							<span class="text-muted tabular-nums">{formatTrackLength(track.durationMs)}</span>
							<!--
								A plain link, not a fetch: the endpoint sets
								Content-Disposition: attachment, so the browser saves it with the
								band's own filename. `download` here would fight that, and a
								scripted save would lose resumability on a long file.
							-->
							<Button
								variant="ghost"
								size="sm"
								href={resolve(`/api/audio/download/${page.params.token}/${track.id}`)}
							>
								<IconDownload size={16} />
								<span class="sr-only">Download {track.title}</span>
							</Button>
						</li>
					{/each}
				</ul>
			</CardBody>
		</Card>
	{/if}
</div>
