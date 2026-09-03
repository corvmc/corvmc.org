<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import CreateReleaseModal from './CreateReleaseModal.svelte';
	import ReleaseCard from './ReleaseCard.svelte';
	import { getBandMusicPage } from '$lib/remote/audio.remote';
	import { getBandLayoutContext } from '../layout-context';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';

	// The layout above already holds the band; re-awaiting it here would be a
	// second remote query in flight. See `layout-context.ts`.
	const bandLayout = getBandLayoutContext();
	const layout = $derived(bandLayout.current);
	const band = $derived(layout.band);

	const { releases, canManage } = $derived(await getBandMusicPage(page.params.slug!));
</script>

<PageHeader title="Music" subtitle={band.name}>
	{#if canManage}
		<CreateReleaseModal bandSlug={band.slug} />
	{/if}
</PageHeader>

<PageContent width="2xl">
	{#if releases.length === 0}
		<EmptyState
			title="No releases yet"
			description="Upload a record and it gets a page on the site, a spot in your profile, and — if you want it — a place in the CMC Radio rotation."
		/>
	{:else}
		<div class="space-y-3">
			{#each releases as release (release.id)}
				<ReleaseCard {release} href={resolve(`/band/${band.slug}/music/${release.id}`)} />
			{/each}
		</div>
	{/if}
</PageContent>
