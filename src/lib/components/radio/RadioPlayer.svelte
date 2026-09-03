<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import {
		IconPlayerPlayFilled,
		IconPlayerPauseFilled,
		IconRadio,
		IconX,
		IconChevronUp
	} from '@tabler/icons-svelte';
	import { getRadioState } from '$lib/remote/radio.remote';
	import { readWidgetState, writeWidgetState, type RadioWidgetState } from './radio-dismiss';
	import { formatTrackLength } from '$lib/utils/audio';
	import { resolve } from '$app/paths';

	type Entry = {
		trackId: string;
		trackTitle: string;
		bandName: string;
		bandSlug: string;
		coverUrl: string | null;
		startsAt: Date;
		endsAt: Date;
		durationMs: number;
	};

	/**
	 * The station bar, mounted in the ROOT layout — the only one that survives
	 * navigation between (public), /member, /band and /staff without remounting
	 * the `<audio>` element and cutting the song off.
	 *
	 * **Nothing here top-level-awaits.** Two traps make an awaiting version fail
	 * in ways that are hard to read: `<svelte:window>` listeners are attached
	 * synchronously and are *not* async-gated, so a handler would run against
	 * undefined state for a round trip (`src/async-gated-listener.spec.ts` fails
	 * the build on that shape), and a `pending` snippet makes `<svelte:boundary>`
	 * skip its contents server-side. The widget is a decoration on every page in
	 * the app, so it fetches in `onMount` and renders nothing until it has an
	 * answer.
	 */
	let widget = $state<RadioWidgetState>('open');
	let enabled = $state(false);
	let current = $state<Entry | null>(null);
	let upNext = $state<Entry[]>([]);

	/**
	 * How far this browser's clock is ahead of the server's, in ms.
	 *
	 * Without it a listener whose machine is a minute fast starts every track a
	 * minute in — or past its end, which reads as the station being broken. This
	 * is what makes "everybody hears the same thing" true rather than roughly
	 * true.
	 */
	let clockSkewMs = $state(0);

	let audio = $state<HTMLAudioElement | null>(null);
	let playing = $state(false);
	let positionMs = $state(0);
	let ticker: ReturnType<typeof setInterval> | null = null;

	function serverTime(): number {
		return Date.now() - clockSkewMs;
	}

	async function refresh() {
		const state = await getRadioState();
		enabled = state.enabled;
		clockSkewMs = Date.now() - new Date(state.serverNow).getTime();
		current = state.current as Entry | null;
		upNext = (state.upNext ?? []) as Entry[];
	}

	/**
	 * Advance to whatever is on now.
	 *
	 * Called on a timer rather than from the element's `ended` event, because the
	 * station's clock is the source of truth and the audio element's is not — a
	 * stall or a slow start would otherwise leave a listener permanently behind
	 * the broadcast, playing yesterday's track to themselves.
	 */
	function tick() {
		if (!current) return;
		const now = serverTime();
		positionMs = now - new Date(current.startsAt).getTime();

		if (now >= new Date(current.endsAt).getTime()) {
			const next = upNext[0];
			if (next && now < new Date(next.endsAt).getTime()) {
				// The window we were handed still covers us: roll forward locally
				// rather than asking the server on every track change.
				current = next;
				upNext = upNext.slice(1);
				if (playing) start();
			} else {
				void refresh().then(() => {
					if (playing) start();
				});
			}
		}
	}

	/** Seek into the live position and play. Never called without a user gesture. */
	function start() {
		if (!audio || !current) return;
		const offsetSeconds = Math.max(0, (serverTime() - new Date(current.startsAt).getTime()) / 1000);
		audio.src = `/api/audio/track/${current.trackId}/stream`;
		audio.currentTime = offsetSeconds;
		audio.play().catch(() => {
			// Autoplay policy, a 404, an unsupported codec. A bar that claims to be
			// playing when it is not is worse than one that visibly is not.
			playing = false;
		});
	}

	function toggle() {
		if (!audio || !current) return;
		if (playing) {
			audio.pause();
			playing = false;
			return;
		}
		playing = true;
		start();
	}

	function setWidget(next: RadioWidgetState) {
		widget = next;
		writeWidgetState(next);
		if (next === 'hidden' && audio) {
			audio.pause();
			playing = false;
		}
	}

	onMount(() => {
		widget = readWidgetState();
		void refresh();
		// One second is enough to keep the progress bar honest and to notice a
		// track boundary; the refetch it triggers happens once per track.
		ticker = setInterval(tick, 1000);
	});

	onDestroy(() => {
		if (ticker) clearInterval(ticker);
	});

	const progress = $derived(
		current && current.durationMs > 0
			? Math.min(100, Math.max(0, (positionMs / current.durationMs) * 100))
			: 0
	);
</script>

<!-- Nothing renders until the station has answered: no flash of an empty bar on
     every page in the app, and nothing at all when the flag is off or the
     rotation is empty. -->
{#if enabled && current && widget !== 'hidden'}
	<audio bind:this={audio} preload="none"></audio>

	{#if widget === 'collapsed'}
		<button
			type="button"
			class="btn fixed bottom-4 left-4 z-40 shadow-lg btn-primary btn-sm"
			onclick={() => setWidget('open')}
		>
			<IconRadio size={16} />
			CMC Radio
		</button>
	{:else}
		<div
			class="fixed inset-x-0 bottom-0 z-40 border-t border-base-300 bg-base-100 shadow-lg"
			aria-label="CMC Radio"
		>
			<!-- Where the station is in the current track. `aria-hidden` because the
			     times are already in the text below it. -->
			<div class="h-1 w-full bg-base-300" aria-hidden="true">
				<div class="h-full bg-primary" style="width: {progress}%"></div>
			</div>

			<div class="flex items-center gap-3 p-2">
				<button
					type="button"
					class="btn btn-circle btn-primary btn-sm"
					aria-label={playing ? 'Pause CMC Radio' : 'Play CMC Radio'}
					onclick={toggle}
				>
					{#if playing}
						<IconPlayerPauseFilled size={16} />
					{:else}
						<IconPlayerPlayFilled size={16} />
					{/if}
				</button>

				{#if current.coverUrl}
					<img src={current.coverUrl} alt="" class="size-10 shrink-0 rounded object-cover" />
				{/if}

				<div class="min-w-0 flex-1">
					<p class="flex items-center gap-1 text-subtle">
						<IconRadio size={12} /> CMC Radio
					</p>
					<p class="truncate">
						<span class="font-medium">{current.trackTitle}</span>
						<span class="text-muted">by</span>
						<!-- The whole reason the widget exists: whoever is playing is one
						     click from their profile. -->
						<a class="link" href={resolve(`/directory/bands/${current.bandSlug}`)}
							>{current.bandName}</a
						>
					</p>
				</div>

				<span class="hidden text-muted tabular-nums sm:inline">
					{formatTrackLength(positionMs)} / {formatTrackLength(current.durationMs)}
				</span>

				<button
					type="button"
					class="btn btn-circle btn-ghost btn-sm"
					aria-label="Minimize CMC Radio"
					onclick={() => setWidget('collapsed')}
				>
					<IconChevronUp size={16} />
				</button>
				<button
					type="button"
					class="btn btn-circle btn-ghost btn-sm"
					aria-label="Close CMC Radio"
					onclick={() => setWidget('hidden')}
				>
					<IconX size={16} />
				</button>
			</div>
		</div>
	{/if}
{/if}
