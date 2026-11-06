<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import CreateReleaseModal from './CreateReleaseModal.svelte';
	import ReleaseCard from './ReleaseCard.svelte';
	import { getBandMusicPage } from '#lib/remote/audio.remote.js';
	import { getBandLayoutContext } from '../layout-context';
	import { resolve } from '$app/paths';
	import { routeParams } from '#lib/route-params.svelte.js';

	const params = routeParams('slug');

	// The layout above already holds the band; re-awaiting it here would be a
	// second remote query in flight. See `layout-context.ts`.
	const bandLayout = getBandLayoutContext();
	const layout = $derived(bandLayout.current);
	const band = $derived(layout.band);

	const { releases, canManage } = $derived(await getBandMusicPage(params.slug));
</script>

<PageHeader width="2xl" title={m.band_slug_music_releases()} subtitle={band.name}>
	{#if canManage}
		<CreateReleaseModal bandSlug={band.slug} />
	{/if}
</PageHeader>

<PageContent width="2xl">
	{#if releases.length === 0}
		<EmptyState
			title={m.band_slug_music_no_releases_yet()}
			description={m.band_slug_music_description()}
		/>
	{:else}
		<div class="space-y-3">
			{#each releases as release (release.id)}
				<ReleaseCard {release} href={resolve(`band/${band.slug}/music/${release.id}`)} />
			{/each}
		</div>
	{/if}
</PageContent>
