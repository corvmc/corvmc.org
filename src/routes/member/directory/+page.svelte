<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { getMemberDirectory } from '#lib/remote/directory.remote.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import { IconPencil } from '@tabler/icons-svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import FreeformTagInput from '#lib/components/ui/FreeformTagInput.svelte';
	import IdCard from '#lib/components/directory/IdCard.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import { directorySortOptions, type DirectorySort } from '#lib/utils/directory-browse.js';

	/** Cards rendered before "Show more" appears. */
	const PAGE_SIZE = 24;

	// Not a filter: changing the order is not something "Clear filters" undoes.
	let sort = $state<DirectorySort>('newest');

	// Filtering here stays server-side (see `filters` below) — unlike the public
	// directory, this view can page through every member, not just the public ones.
	let search = $state('');
	let filterInstruments = $state<string[]>([]);
	let filterGenres = $state<string[]>([]);
	let filterSkills = $state<string[]>([]);
	let lookingForBand = $state(false);
	let availableForHire = $state(false);
	let teachesLessons = $state(false);
	let openToCollaboration = $state(false);
	// `?teaches=collective` is where the old Teachers page redirects. Read once:
	// above the await, so it exists on the first render.
	let teachesAtCollective = $state(page.url.searchParams.get('teaches') === 'collective');

	let filters = $derived({
		search: search || undefined,
		instruments: filterInstruments.length > 0 ? JSON.stringify(filterInstruments) : undefined,
		genres: filterGenres.length > 0 ? JSON.stringify(filterGenres) : undefined,
		skills: filterSkills.length > 0 ? JSON.stringify(filterSkills) : undefined,
		lookingForBand: lookingForBand ? 'true' : undefined,
		availableForHire: availableForHire ? 'true' : undefined,
		teachesLessons: teachesLessons ? 'true' : undefined,
		openToCollaboration: openToCollaboration ? 'true' : undefined,
		teachesAtCollective: teachesAtCollective ? 'true' : undefined
	});

	const hasFilters = $derived(Object.values(filters).some((v) => v !== undefined));
	const query = $derived({ ...filters, sort: sort === 'newest' ? undefined : sort });

	function clearFilters() {
		search = '';
		filterInstruments = [];
		filterGenres = [];
		filterSkills = [];
		lookingForBand = false;
		availableForHire = false;
		teachesLessons = false;
		openToCollaboration = false;
		teachesAtCollective = false;
	}

	// One query, not one per list: one is what this component can hold without kit 2.64
	// rendering the error boundary instead of the page.
	const directory = $derived(await getMemberDirectory(query));
	const members = $derived(directory.members);
	const instrumentSuggestions = $derived(directory.instrumentSuggestions);
	const genreSuggestions = $derived(directory.genreSuggestions);
	const skillSuggestions = $derived(directory.skillSuggestions);

	// The "Show more" window collapses whenever the listed set changes. Derived
	// off a key rather than reset from an effect, so it can't lag the filters by
	// a frame.
	const listKey = $derived(JSON.stringify(query));
	let expandedTo = $state(PAGE_SIZE);
	let expandedFor = $state('');
	const limit = $derived(expandedFor === listKey ? expandedTo : PAGE_SIZE);

	const remaining = $derived(Math.max(0, members.length - limit));

	function showMore() {
		expandedTo = limit + PAGE_SIZE;
		expandedFor = listKey;
	}
</script>

<PageHeader title={m.member_directory_title()} subtitle={m.member_community()}>
	<!-- The other half of the link on the profile editor: the entry you are
	     looking at is the shape yours takes, and Profile left the sidebar for
	     the account menu (#1244). -->
	<Button href={resolve('member/profile')} variant="ghost" size="sm">
		<IconPencil size={16} />
		{m.member_directory_edit_profile()}
	</Button>
</PageHeader>
<PageContent>
	{#if directory.viewerHiddenBecause === 'incomplete'}
		<Alert type="info" href={resolve('member/profile')}>
			{m.member_directory_re_not_listed_here_yet()}
		</Alert>
	{:else if directory.viewerHiddenBecause === 'hidden'}
		<Alert type="info" href={resolve('member/profile')}>
			{m.member_directory_profile_hidden_so_re_not()}
		</Alert>
	{/if}

	<!-- Search & Filters -->
	<div class="directory-filters">
		<div class="directory-filters__row">
			<input
				type="text"
				placeholder={m.member_search_by_name()}
				aria-label={m.member_search_by_name_2()}
				class="input flex-1"
				bind:value={search}
			/>
			<FormField
				type="select"
				name="sort"
				label={m.member_sort()}
				options={directorySortOptions}
				bind:value={sort}
			/>
			<label class="directory-filters__toggle">
				<input type="checkbox" class="checkbox checkbox-sm" bind:checked={lookingForBand} />
				<span>{m.member_directory_looking_band()}</span>
			</label>
			<label class="directory-filters__toggle">
				<input type="checkbox" class="checkbox checkbox-sm" bind:checked={availableForHire} />
				<span>{m.member_available_hire()}</span>
			</label>
			<!-- Two different truths: a self-declared flag, and the instructor record. -->
			<label class="directory-filters__toggle">
				<input type="checkbox" class="checkbox checkbox-sm" bind:checked={teachesLessons} />
				<span>{m.member_teaches_privately()}</span>
			</label>
			<label class="directory-filters__toggle">
				<input
					type="checkbox"
					name="teachesAtCollective"
					class="checkbox checkbox-sm"
					bind:checked={teachesAtCollective}
				/>
				<span>{m.member_directory_teaches_at_collective()}</span>
			</label>
			<label class="directory-filters__toggle">
				<input type="checkbox" class="checkbox checkbox-sm" bind:checked={openToCollaboration} />
				<span>{m.member_open_collaboration()}</span>
			</label>
		</div>
		<div class="directory-filters__tags">
			<div class="directory-filters__tag-field">
				<p class="directory-filters__label">{m.member_instruments()}</p>
				<FreeformTagInput
					bind:value={filterInstruments}
					suggestions={instrumentSuggestions}
					placeholder={m.member_directory_filter_by_instrument()}
				/>
			</div>
			<div class="directory-filters__tag-field">
				<p class="directory-filters__label">{m.member_skills()}</p>
				<FreeformTagInput
					bind:value={filterSkills}
					suggestions={skillSuggestions}
					placeholder={m.member_directory_filter_by_skill()}
				/>
			</div>
			<div class="directory-filters__tag-field">
				<p class="directory-filters__label">{m.member_genres()}</p>
				<FreeformTagInput
					bind:value={filterGenres}
					suggestions={genreSuggestions}
					placeholder={m.member_filter_by_genre()}
				/>
			</div>
		</div>
	</div>

	{#if members.length === 0}
		{#if hasFilters}
			<EmptyState>
				<p>{m.member_directory_no_members_match_filters()}</p>
				<Button variant="ghost" size="sm" class="mt-2" onclick={clearFilters}
					>{m.member_clear_filters()}</Button
				>
			</EmptyState>
		{:else}
			<EmptyState message={m.member_directory_message()} />
		{/if}
	{:else}
		<div class="grid-gallery">
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

	{#if remaining > 0}
		<div class="flex justify-center">
			<Button variant="default" size="sm" outline onclick={showMore}>
				{m.member_show_more_left({ remaining })}
			</Button>
		</div>
	{/if}
</PageContent>
