<script lang="ts">
	import ProfileSection from './ProfileSection.svelte';
	import { releaseKindLabels, type ReleaseKind } from '$lib/config';
	import { formatTrackSummary } from '$lib/utils/audio';
	import { formatDateYear, formatDollars } from '$lib/utils/format';
	import { resolve } from '$app/paths';
	import { IconDisc } from '@tabler/icons-svelte';

	/**
	 * A band's discography on its profile, beside the streaming-service strip.
	 *
	 * Deliberately next to `ListenStrip` rather than replacing it: that one points
	 * at Spotify and YouTube, and this one is the music the collective actually
	 * hosts and the band actually gets paid for. Both are true at once.
	 */
	let {
		releases,
		bandSlug
	}: {
		releases: {
			id: string;
			title: string;
			slug: string;
			kind: ReleaseKind;
			releasedAt: Date | null;
			priceMinCents: number;
			allowPayMore: boolean;
			coverUrl: string | null;
			trackCount: number;
			durationMs: number;
		}[];
		bandSlug: string;
	} = $props();
</script>

<!-- Nothing at all when there is nothing: an empty "Music" heading on a profile
     reads as something broken rather than as something absent. -->
{#if releases.length > 0}
	<ProfileSection title="Music" note={`${releases.length} on CMC`}>
		<ul class="space-y-3">
			{#each releases as release (release.id)}
				<li>
					<a
						class="flex items-center gap-3 rounded p-2 transition-colors hover:bg-base-200"
						href={resolve(`/music/${bandSlug}/${release.slug}`)}
					>
						{#if release.coverUrl}
							<img src={release.coverUrl} alt="" class="size-14 shrink-0 rounded object-cover" />
						{:else}
							<div class="grid size-14 shrink-0 place-items-center rounded bg-base-200 text-subtle">
								<IconDisc size={20} />
							</div>
						{/if}
						<span class="min-w-0 flex-1">
							<span class="block truncate font-medium">{release.title}</span>
							<span class="block truncate text-muted">
								{releaseKindLabels[release.kind]} · {formatTrackSummary(
									release.trackCount,
									release.durationMs
								)}{release.releasedAt ? ` · ${formatDateYear(release.releasedAt)}` : ''}
							</span>
						</span>
						<span class="shrink-0 text-muted">
							{release.priceMinCents === 0 ? 'Free' : formatDollars(release.priceMinCents)}
						</span>
					</a>
				</li>
			{/each}
		</ul>
	</ProfileSection>
{/if}
