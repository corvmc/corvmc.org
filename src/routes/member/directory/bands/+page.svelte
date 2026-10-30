<script lang="ts">
	import { resolve } from '$app/paths';
	import { getMemberBandDirectory } from '$lib/remote/directory.remote';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import FreeformTagInput from '$lib/components/ui/FreeformTagInput.svelte';
	import VinylCard from '$lib/components/directory/VinylCard.svelte';
	import { hashIndex } from '$lib/utils/patterns';
	import { BAND_COLORS } from '$lib/utils/directory-browse';
	import { m } from '$lib/paraglide/messages.js';
	import { many } from '$lib/terms';

	/** Cards rendered before "Show more" appears. */
	const PAGE_SIZE = 24;

	const bandsLabel = many(m.term_band);
	const bandsNoun = m.term_band({ count: 2 });

	let search = $state('');
	let filterGenres = $state<string[]>([]);
	let lookingForMembers = $state(false);

	let filters = $derived({
		search: search || undefined,
		genres: filterGenres.length > 0 ? JSON.stringify(filterGenres) : undefined,
		lookingForMembers: lookingForMembers ? 'true' : undefined
	});

	const hasFilters = $derived(Object.values(filters).some((v) => v !== undefined));

	function clearFilters() {
		search = '';
		filterGenres = [];
		lookingForMembers = false;
	}

	const directory = $derived(await getMemberBandDirectory(filters));
	const bands = $derived(directory.bands);

	// Collapses whenever the listed set changes; keyed rather than reset from an
	// effect, so it can't lag the filters by a frame.
	const listKey = $derived(JSON.stringify(filters));
	let expandedTo = $state(PAGE_SIZE);
	let expandedFor = $state('');
	const limit = $derived(expandedFor === listKey ? expandedTo : PAGE_SIZE);
	const remaining = $derived(Math.max(0, bands.length - limit));

	function showMore() {
		expandedTo = limit + PAGE_SIZE;
		expandedFor = listKey;
	}

	// Keyed on the band id, not the loop index: an index-keyed colour reshuffles
	// every card in the grid as soon as a filter narrows the list.
	function bandColor(id: string): string {
		return BAND_COLORS[hashIndex(id, BAND_COLORS.length)];
	}
</script>

<PageHeader title={bandsLabel} subtitle="Community">
	<Button href={resolve('/member/bands?create=1')} variant="ghost" data-sveltekit-reload>
		New
	</Button>
</PageHeader>
<PageContent>
	<div class="directory-filters">
		<div class="directory-filters__row">
			<input
				type="text"
				placeholder="Search by name..."
				aria-label="Search by name"
				class="input flex-1"
				bind:value={search}
			/>
			<label class="directory-filters__toggle">
				<input type="checkbox" class="checkbox checkbox-sm" bind:checked={lookingForMembers} />
				<span>Looking for members</span>
			</label>
		</div>
		<div class="directory-filters__tags">
			<div class="directory-filters__tag-field">
				<p class="directory-filters__label">Genres</p>
				<FreeformTagInput
					bind:value={filterGenres}
					suggestions={directory.genreSuggestions}
					placeholder="Filter by genre..."
				/>
			</div>
		</div>
	</div>

	{#if bands.length === 0}
		{#if hasFilters}
			<EmptyState>
				<p>No {bandsNoun} match your filters.</p>
				<Button variant="ghost" size="sm" class="mt-2" onclick={clearFilters}>Clear filters</Button>
			</EmptyState>
		{:else}
			<EmptyState message="No {bandsNoun} in the directory yet." />
		{/if}
	{:else}
		<div class="grid-gallery-tight">
			{#each bands.slice(0, limit) as b (b.id)}
				<VinylCard
					href="/member/directory/bands/{b.slug}"
					id={b.id}
					name={b.name}
					avatarUrl={b.avatarUrl}
					tagline={b.tagline}
					memberCount={b.memberCount}
					genres={b.genres}
					lookingForMembers={b.lookingForMembers}
					color={bandColor(b.id)}
				/>
			{/each}
		</div>
	{/if}

	{#if remaining > 0}
		<div class="flex justify-center">
			<Button variant="default" size="sm" outline onclick={showMore}>
				Show more ({remaining} left)
			</Button>
		</div>
	{/if}
</PageContent>
