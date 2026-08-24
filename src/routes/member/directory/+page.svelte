<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import {
		getDirectoryMembers,
		getDirectoryBands,
		getInstrumentSuggestions,
		getGenreSuggestions
	} from '$lib/remote/directory.remote';
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import TabBar from '$lib/components/shared/TabBar.svelte';
	import Button from '$lib/components/shared/Button.svelte';
	import EmptyState from '$lib/components/shared/EmptyState.svelte';
	import FreeformTagInput from '$lib/components/shared/FreeformTagInput.svelte';
	import IdCard from '$lib/components/shared/directory/IdCard.svelte';
	import VinylCard from '$lib/components/shared/directory/VinylCard.svelte';
	import { hashIndex } from '$lib/utils/patterns';
	import { BAND_COLORS } from '$lib/utils/directory-browse';

	type Tab = 'members' | 'bands';

	/** Cards rendered before "Show more" appears. */
	const PAGE_SIZE = 24;

	// Members lead here — this side of the directory is for finding people to
	// play with. The tab lives in the URL so a refresh or a shared link keeps it,
	// and the tabs below are real links rather than local state. Everything that
	// reads `page.url` is declared above the top-level awaits: declarations after
	// one are async-gated and wouldn't exist during the first render.
	const tab = $derived<Tab>(page.url.searchParams.get('tab') === 'bands' ? 'bands' : 'members');

	function directoryHref(target: Tab): string {
		return `${resolve('/member/directory')}${target === 'bands' ? '?tab=bands' : ''}`;
	}

	// Filtering here stays server-side (see `filters` below) — unlike the public
	// directory, this view can page through every member, not just the public ones.
	let search = $state('');
	let filterInstruments = $state<string[]>([]);
	let filterGenres = $state<string[]>([]);
	let lookingForBand = $state(false);
	let availableForHire = $state(false);
	let teachesLessons = $state(false);
	let openToCollaboration = $state(false);
	let lookingForMembers = $state(false);

	let filters = $derived({
		search: search || undefined,
		instruments: filterInstruments.length > 0 ? JSON.stringify(filterInstruments) : undefined,
		genres: filterGenres.length > 0 ? JSON.stringify(filterGenres) : undefined,
		lookingForBand: lookingForBand ? 'true' : undefined,
		availableForHire: availableForHire ? 'true' : undefined,
		teachesLessons: teachesLessons ? 'true' : undefined,
		openToCollaboration: openToCollaboration ? 'true' : undefined,
		lookingForMembers: lookingForMembers ? 'true' : undefined
	});

	const hasFilters = $derived(Object.values(filters).some((v) => v !== undefined));

	function clearFilters() {
		search = '';
		filterInstruments = [];
		filterGenres = [];
		lookingForBand = false;
		availableForHire = false;
		teachesLessons = false;
		openToCollaboration = false;
		lookingForMembers = false;
	}

	let members = $derived(await getDirectoryMembers(filters));
	let bands = $derived(await getDirectoryBands(filters));
	let instrumentSuggestions = $derived(await getInstrumentSuggestions());
	let genreSuggestions = $derived(await getGenreSuggestions());

	// The "Show more" window collapses whenever the listed set changes. Derived
	// off a key rather than reset from an effect, so it can't lag the filters by
	// a frame or expand the tab you just switched to.
	const listKey = $derived(`${tab} ${JSON.stringify(filters)}`);
	let expandedTo = $state(PAGE_SIZE);
	let expandedFor = $state('');
	const limit = $derived(expandedFor === listKey ? expandedTo : PAGE_SIZE);

	const shown = $derived(tab === 'bands' ? bands : members);
	const remaining = $derived(Math.max(0, shown.length - limit));

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

{#snippet empty(noun: string)}
	{#if hasFilters}
		<EmptyState>
			<p>No {noun} match your filters.</p>
			<Button variant="ghost" size="sm" class="mt-2" onclick={clearFilters}>Clear filters</Button>
		</EmptyState>
	{:else}
		<EmptyState message="No {noun} in the directory yet." />
	{/if}
{/snippet}

<PageHeader title="Directory" subtitle="Community">
	<TabBar
		tabs={[
			{ key: 'members', label: 'Members', badge: members.length, href: directoryHref('members') },
			{ key: 'bands', label: 'Bands', badge: bands.length, href: directoryHref('bands') }
		]}
		active={tab}
	/>
</PageHeader>
<PageContent>
	<!-- Search & Filters -->
	<div class="directory-filters">
		<div class="directory-filters__row">
			<input
				type="text"
				placeholder="Search by name..."
				aria-label="Search by name"
				class="input flex-1"
				bind:value={search}
			/>
			{#if tab === 'members'}
				<label class="directory-filters__toggle">
					<input type="checkbox" class="checkbox checkbox-sm" bind:checked={lookingForBand} />
					<span>Looking for band</span>
				</label>
				<label class="directory-filters__toggle">
					<input type="checkbox" class="checkbox checkbox-sm" bind:checked={availableForHire} />
					<span>Available for hire</span>
				</label>
				<label class="directory-filters__toggle">
					<input type="checkbox" class="checkbox checkbox-sm" bind:checked={teachesLessons} />
					<span>Teaches lessons</span>
				</label>
				<label class="directory-filters__toggle">
					<input type="checkbox" class="checkbox checkbox-sm" bind:checked={openToCollaboration} />
					<span>Open to collaboration</span>
				</label>
			{:else}
				<label class="directory-filters__toggle">
					<input type="checkbox" class="checkbox checkbox-sm" bind:checked={lookingForMembers} />
					<span>Looking for members</span>
				</label>
			{/if}
		</div>
		<div class="directory-filters__tags">
			{#if tab === 'members'}
				<div class="directory-filters__tag-field">
					<p class="directory-filters__label">Instruments</p>
					<FreeformTagInput
						bind:value={filterInstruments}
						suggestions={instrumentSuggestions}
						placeholder="Filter by instrument..."
					/>
				</div>
			{/if}
			<div class="directory-filters__tag-field">
				<p class="directory-filters__label">Genres</p>
				<FreeformTagInput
					bind:value={filterGenres}
					suggestions={genreSuggestions}
					placeholder="Filter by genre..."
				/>
			</div>
		</div>
	</div>

	{#if tab === 'members'}
		{#if members.length === 0}
			{@render empty('members')}
		{:else}
			<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 justify-items-center">
				{#each members.slice(0, limit) as member (member.id)}
					<IdCard
						href="/member/directory/members/{member.id}"
						name={member.name}
						image={member.image}
						pronouns={member.pronouns}
						tagline={member.tagline}
						instruments={member.instruments}
						genres={member.genres}
						bands={member.bands}
						lookingForBand={member.lookingForBand}
						availableForHire={member.availableForHire}
						teachesLessons={member.teachesLessons}
						openToCollaboration={member.openToCollaboration}
						memberSince={new Date(member.createdAt).getFullYear()}
					/>
				{/each}
			</div>
		{/if}
	{:else if bands.length === 0}
		{@render empty('bands')}
	{:else}
		<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6 justify-items-center">
			{#each bands.slice(0, limit) as b (b.id)}
				<VinylCard
					href="/member/directory/bands/{b.slug}"
					id={b.id}
					name={b.name}
					avatarUrl={b.avatarUrl}
					tagline={b.tagline}
					memberCount={b.memberCount}
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
