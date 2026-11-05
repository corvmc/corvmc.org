<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { onMount } from 'svelte';
	import Card from '#lib/components/ui/Card/Card.svelte';
	import CardBody from '#lib/components/ui/Card/CardBody.svelte';
	import CardTitle from '#lib/components/ui/Card/CardTitle.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import { getRadioPage } from '#lib/remote/radio.remote.js';
	import { writeWidgetState } from '#lib/components/radio/radio-dismiss.js';
	import { formatTrackLength } from '#lib/utils/audio.js';
	import { IconRadio } from '@tabler/icons-svelte';
	import { resolve } from '$app/paths';

	const { current, upNext, recent, bands } = $derived(await getRadioPage());

	/**
	 * Coming here un-dismisses the widget.
	 *
	 * This page is the way back from having closed the bar — the footer link
	 * points here, and without this a visitor who dismissed it once could never
	 * get it back short of clearing site data. Deliberately unconditional: asking
	 * to see the station is the same act as wanting the player.
	 */
	onMount(() => writeWidgetState('open'));
</script>

<svelte:head>
	<title>{m.public_radio_cmc_radio_corvallis_music_collective()}</title>
	<meta
		name="description"
		content="A continuous stream of music by bands at the Corvallis Music Collective."
	/>
</svelte:head>

<div class="mx-auto max-w-3xl space-y-6 p-6">
	<div>
		<h1 class="flex items-center gap-2 text-3xl font-semibold">
			<IconRadio size={28} />
			{m.public_radio_cmc_radio()}
		</h1>
		<p class="text-muted">
			{m.public_radio_music_by_bands_at_collective()}
		</p>
	</div>

	{#if !current}
		<EmptyState title={m.public_radio_title()} description={m.public_radio_description()} />
	{:else}
		<Card>
			<CardBody row class="items-center gap-4">
				{#if current.coverUrl}
					<img src={current.coverUrl} alt="" class="size-20 shrink-0 rounded object-cover" />
				{/if}
				<div class="min-w-0">
					<p class="text-subtle">{m.public_radio_now_playing()}</p>
					<p class="truncate text-xl font-medium">{current.trackTitle}</p>
					<p class="truncate">
						<a class="link" href={resolve(`directory/bands/${current.bandSlug}`)}
							>{current.bandName}</a
						>
						<span class="text-muted">· {current.releaseTitle}</span>
					</p>
				</div>
			</CardBody>
		</Card>

		{#if upNext.length > 0}
			<Card>
				<CardBody>
					<CardTitle>{m.public_radio_up_next()}</CardTitle>
					<ul class="divide-y divide-base-300">
						{#each upNext as entry (entry.playId)}
							<li class="flex items-center gap-2 py-2">
								<span class="min-w-0 flex-1 truncate">
									{entry.trackTitle}
									<span class="text-muted">— {entry.bandName}</span>
								</span>
								<span class="text-muted tabular-nums">
									{formatTrackLength(entry.durationMs)}
								</span>
							</li>
						{/each}
					</ul>
				</CardBody>
			</Card>
		{/if}
	{/if}

	{#if recent.length > 0}
		<Card>
			<CardBody>
				<CardTitle>{m.public_radio_recently_played()}</CardTitle>
				<ul class="divide-y divide-base-300">
					{#each recent as entry (entry.playId)}
						<li class="flex items-center gap-2 py-2">
							<span class="min-w-0 flex-1 truncate">
								{entry.trackTitle}
								<span class="text-muted">— </span>
								<a class="link" href={resolve(`directory/bands/${entry.bandSlug}`)}
									>{entry.bandName}</a
								>
							</span>
						</li>
					{/each}
				</ul>
			</CardBody>
		</Card>
	{/if}

	{#if bands.length > 0}
		<Card>
			<CardBody>
				<CardTitle>{m.public_radio_rotation()}</CardTitle>
				<p class="flex flex-wrap gap-x-3 gap-y-1">
					{#each bands as b (b.slug)}
						<a class="link" href={resolve(`directory/bands/${b.slug}`)}>{b.name}</a>
					{/each}
				</p>
			</CardBody>
		</Card>
	{/if}
</div>
