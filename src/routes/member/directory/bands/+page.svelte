<script lang="ts">
	import { resolve } from '$app/paths';
	import { getMemberBandDirectory } from '#lib/remote/directory.remote.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import FreeformTagInput from '#lib/components/ui/FreeformTagInput.svelte';
	import VinylCard from '#lib/components/directory/VinylCard.svelte';
	import { hashIndex } from '#lib/utils/patterns.js';
	import {
		BAND_COLORS,
		directorySortOptions,
		type DirectorySort
	} from '#lib/utils/directory-browse.js';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import { m } from '#lib/paraglide/messages.js';
	import { many } from '#lib/terms.js';

	/** Cards rendered before "Show more" appears. */
	const PAGE_SIZE = 24;

	const bandsLabel = many(m.term_band);
	const bandsNoun = m.term_band({ count: 2 });

	let search = $state('');
	let filterGenres = $state<string[]>([]);
	let lookingForMembers = $state(false);
	// Not a filter: "Clear filters" leaves the order alone.
	let sort = $state<DirectorySort>('newest');

	let filters = $derived({
		search: search || undefined,
		genres: filterGenres.length > 0 ? JSON.stringify(filterGenres) : undefined,
		lookingForMembers: lookingForMembers ? 'true' : undefined
	});

	const hasFilters = $derived(Object.values(filters).some((v) => v !== undefined));
	const query = $derived({ ...filters, sort: sort === 'newest' ? undefined : sort });

	function clearFilters() {
		search = '';
		filterGenres = [];
		lookingForMembers = false;
	}

	const directory = $derived(await getMemberBandDirectory(query));
	const bands = $derived(directory.bands);

	// Collapses whenever the listed set changes; keyed rather than reset from an
	// effect, so it can't lag the filters by a frame.
	const listKey = $derived(JSON.stringify(query));
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

<PageHeader title={bandsLabel} subtitle={m.member_community_body()}>
	<Button href={resolve('member/bands?create=1')} variant="ghost" data-sveltekit-reload>
		{m.member_new_label()}
	</Button>
</PageHeader>
<PageContent>
	<div class="directory-filters">
		<div class="directory-filters__row">
			<input
				type="text"
				placeholder={m.member_search_by_name_placeholder()}
				aria-label={m.member_search_by_name_2_label()}
				class="input flex-1"
				bind:value={search}
			/>
			<FormField
				type="select"
				name="sort"
				label={m.member_sort_label()}
				options={directorySortOptions}
				bind:value={sort}
			/>
			<label class="directory-filters__toggle">
				<input type="checkbox" class="checkbox checkbox-sm" bind:checked={lookingForMembers} />
				<span>{m.member_looking_members_label()}</span>
			</label>
		</div>
		<div class="directory-filters__tags">
			<div class="directory-filters__tag-field">
				<p class="directory-filters__label">{m.member_genres_text()}</p>
				<FreeformTagInput
					bind:value={filterGenres}
					suggestions={directory.genreSuggestions}
					placeholder={m.member_filter_by_genre_placeholder()}
				/>
			</div>
		</div>
	</div>

	{#if bands.length === 0}
		{#if hasFilters}
			<EmptyState>
				<p>{m.member_directory_bands_no_match_filters_text({ bandsNoun })}</p>
				<Button variant="ghost" size="sm" class="mt-2" onclick={clearFilters}
					>{m.member_clear_filters_label()}</Button
				>
			</EmptyState>
		{:else}
			<EmptyState message={m.member_directory_bands_message_body({ bandsNoun })} />
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
				{m.member_show_more_left_label({ remaining })}
			</Button>
		</div>
	{/if}
</PageContent>
