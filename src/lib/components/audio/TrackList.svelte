<script lang="ts">
	import { IconPlayerPlayFilled, IconPlayerPauseFilled } from '@tabler/icons-svelte';
	import { formatTrackLength } from '$lib/utils/audio';

	export type PlayableTrack = {
		id: string;
		title: string;
		trackNumber: number;
		durationMs: number;
	};

	let {
		tracks,
		/** Rendered after each row — the band panel puts rename and delete here. */
		rowActions,
		empty = 'No tracks yet.'
	}: {
		tracks: PlayableTrack[];
		rowActions?: import('svelte').Snippet<[PlayableTrack]>;
		empty?: string;
	} = $props();

	/**
	 * One `<audio>` element for the whole list, not one per row.
	 *
	 * Per-row elements each hold their own buffered range, so a ten-track record
	 * is ten open connections the moment anyone scrubs, and pausing one does not
	 * stop another — the failure everyone hits is two tracks playing at once.
	 * Swapping `src` on a single element makes "only one thing plays" structural
	 * rather than something every handler has to remember.
	 */
	let audio = $state<HTMLAudioElement | null>(null);
	let playingId = $state<string | null>(null);
	let paused = $state(true);
	let positionMs = $state(0);

	function srcFor(trackId: string) {
		return `/api/audio/track/${trackId}/stream`;
	}

	function toggle(track: PlayableTrack) {
		if (!audio) return;

		if (playingId !== track.id) {
			playingId = track.id;
			positionMs = 0;
			audio.src = srcFor(track.id);
			// `play()` rejects when the browser blocks it or the source 404s.
			// Either way the row must not be left claiming to play.
			audio.play().catch(() => {
				playingId = null;
				paused = true;
			});
			return;
		}

		if (audio.paused) void audio.play().catch(() => (paused = true));
		else audio.pause();
	}

	function onTimeUpdate() {
		if (audio) positionMs = audio.currentTime * 1000;
	}

	function onEnded() {
		// Roll into the next track, so a record plays through the way a record does.
		const index = tracks.findIndex((t) => t.id === playingId);
		const next = index >= 0 ? tracks[index + 1] : undefined;
		if (next) toggle(next);
		else {
			playingId = null;
			positionMs = 0;
		}
	}

	/** 0–100 for the row's progress underline. */
	function progress(track: PlayableTrack): number {
		if (track.id !== playingId || track.durationMs <= 0) return 0;
		return Math.min(100, (positionMs / track.durationMs) * 100);
	}
</script>

<audio bind:this={audio} bind:paused ontimeupdate={onTimeUpdate} onended={onEnded} preload="none"
></audio>

{#if tracks.length === 0}
	<p class="py-6 text-center text-muted">{empty}</p>
{:else}
	<ul class="divide-y divide-base-300">
		{#each tracks as track (track.id)}
			{@const active = track.id === playingId}
			<li class="relative">
				<!-- The played-so-far underline. Rendered behind the row rather than
				     as a <progress>, which cannot sit under content. -->
				<div
					class="pointer-events-none absolute inset-y-0 left-0 bg-primary/10"
					style="width: {progress(track)}%"
				></div>
				<div class="relative flex items-center gap-3 py-2">
					<button
						type="button"
						class="btn btn-circle btn-ghost btn-sm"
						aria-label={active && !paused ? `Pause ${track.title}` : `Play ${track.title}`}
						onclick={() => toggle(track)}
					>
						{#if active && !paused}
							<IconPlayerPauseFilled size={16} />
						{:else}
							<IconPlayerPlayFilled size={16} />
						{/if}
					</button>

					<span class="w-6 text-right text-subtle tabular-nums">{track.trackNumber}</span>

					<span class="flex-1 truncate" class:font-medium={active}>{track.title}</span>

					<span class="text-muted tabular-nums">
						{#if active}
							{formatTrackLength(positionMs)} / {formatTrackLength(track.durationMs)}
						{:else}
							{formatTrackLength(track.durationMs)}
						{/if}
					</span>

					{#if rowActions}
						{@render rowActions(track)}
					{/if}
				</div>
			</li>
		{/each}
	</ul>
{/if}
