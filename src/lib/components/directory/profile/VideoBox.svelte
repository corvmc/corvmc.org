<script lang="ts">
	import ProfileSection from './ProfileSection.svelte';
	import { detectPlatform } from '$lib/utils/link-platform';
	import type { BandVideo } from '$lib/types/band-page';

	/**
	 * Live clips, on a band-site act's public page.
	 *
	 * One player at a time, the same shape `ListenStrip` uses for audio: four
	 * autoplaying iframes stacked down a page is worse than one with a row of
	 * tabs. Anything without a recognised embed is dropped rather than rendered
	 * as a dead frame.
	 */
	let { videos = [] }: { videos?: BandVideo[] } = $props();

	const playable = $derived(
		videos
			.map((v) => ({ video: v, embedUrl: detectPlatform(v.url)?.embedUrl }))
			.filter((v): v is { video: BandVideo; embedUrl: string } => !!v.embedUrl)
	);

	let activeIndex = $state(0);
	const active = $derived(playable[activeIndex] ?? playable[0]);
</script>

{#if active}
	<ProfileSection title="Watch">
		{#if playable.length > 1}
			<div class="video__tabs">
				{#each playable as item, i (item.video.url)}
					<button
						type="button"
						class="video__tab"
						class:is-active={i === activeIndex}
						onclick={() => (activeIndex = i)}
					>
						{item.video.label || `Video ${i + 1}`}
					</button>
				{/each}
			</div>
		{/if}
		<iframe
			src={active.embedUrl}
			title={active.video.label || 'Live video'}
			width="100%"
			height="315"
			frameborder="0"
			allow="clipboard-write; encrypted-media; picture-in-picture"
			allowfullscreen
			loading="lazy"
			class="video__frame"
		></iframe>
	</ProfileSection>
{/if}

<style>
	.video__tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-bottom: 12px;
	}
	.video__tab {
		font-size: 12px;
		font-weight: 600;
		padding: 5px 11px;
		border-radius: var(--radius-pill, 9999px);
		border: 1px solid color-mix(in oklch, var(--cmc-brown) 28%, transparent);
		background: var(--bg-card);
		color: var(--fg-2);
		cursor: pointer;
	}
	.video__tab.is-active {
		background: var(--color-secondary);
		color: var(--bg-card);
	}
	.video__frame {
		border-radius: var(--radius-box, 8px);
		display: block;
	}
</style>
