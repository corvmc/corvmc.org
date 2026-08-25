<script lang="ts">
	import Button from '$lib/components/shared/Button.svelte';
	import { getBandSiteData } from '$lib/remote/band-site.remote';
	import { resolve } from '$app/paths';
	import { formatDate, formatTime, formatCents } from '$lib/utils/format';
	import { bandSiteHref } from '$lib/utils/band-site-url';
	import { page } from '$app/state';
	import { imageSrc } from '$lib/utils/images';

	let data = $derived(await getBandSiteData(page.params.slug!));
	const events = $derived(data.events);
	const pastEvents = $derived(data.pastEvents);
</script>

<svelte:head>
	<title>Events — {data.band.name}</title>
</svelte:head>

<div class="mx-auto max-w-3xl px-6 py-12">
	<a href={bandSiteHref(page.params.slug!, '', page.url)} class="mb-6 block link text-muted">
		&larr; Back to {data.band.name}
	</a>

	<h1 class="mb-8 text-3xl font-bold">All Events</h1>

	{#if events.length === 0 && pastEvents.length === 0}
		<p class="py-12 text-center opacity-60">No events yet.</p>
	{:else if events.length === 0}
		<p class="py-4 opacity-60">No upcoming events.</p>
	{:else}
		<div class="space-y-4">
			{#each events as evt (evt.id)}
				<div
					class="flex items-start justify-between rounded-lg p-5"
					style="background-color: var(--bs-surface, oklch(var(--b2)));"
				>
					<div>
						{#if evt.posterUrl}
							{@const poster = imageSrc(evt.posterUrl, 'thumb')}
							<img
								src={poster.src}
								srcset={poster.srcset}
								alt=""
								class="float-left mr-4 h-16 w-16 rounded-lg object-cover"
							/>
						{/if}
						<h2 class="text-lg font-semibold">{evt.title}</h2>
						<p class="mt-1 text-muted">
							{formatDate(evt.startsAt)} &middot; {formatTime(evt.startsAt)}
						</p>
						{#if evt.location}
							<p class="text-muted">{evt.location}</p>
						{/if}
						{#if evt.ticketPrice}
							<p class="text-muted">{formatCents(evt.ticketPrice)}</p>
						{/if}
						{#if evt.description}
							<p class="mt-2 text-sm opacity-80">{evt.description}</p>
						{/if}
					</div>
					{#if evt.externalTicketUrl}
						<Button
							href={evt.externalTicketUrl}
							target="_blank"
							rel="noopener external"
							variant="primary"
							size="sm"
							class="ml-4 shrink-0"
						>
							Tickets
						</Button>
					{/if}
				</div>
			{/each}
		</div>
	{/if}

	{#if pastEvents.length > 0}
		<h2 class="mt-12 mb-4 text-xl font-bold opacity-70">Past Shows</h2>
		<div class="space-y-2">
			{#each pastEvents as evt (evt.id)}
				<div class="flex items-baseline gap-3 text-sm">
					<span class="shrink-0 tabular-nums opacity-60">{formatDate(evt.startsAt)}</span>
					<span class="font-medium">{evt.title}</span>
					{#if evt.location}
						<span class="truncate opacity-60">{evt.location}</span>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>

<!-- Minimal footer -->
<footer class="py-6 text-center text-xs opacity-40">
	<a href={resolve('/')} class="hover:opacity-70">Corvallis Music Collective</a>
</footer>
