<script lang="ts">
	import type { ResolvedPathname } from '$app/types';
	import Section from '$lib/components/public/Section.svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import TabBar from '$lib/components/ui/TabBar.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import IdCard from '$lib/components/directory/IdCard.svelte';
	import IdCardCta from '$lib/components/directory/IdCardCta.svelte';
	import VinylCard from '$lib/components/directory/VinylCard.svelte';
	import VinylCardCta from '$lib/components/directory/VinylCardCta.svelte';
	import { getPublicDirectoryPage } from '$lib/remote/directory.remote';
	import { hashIndex } from '$lib/utils/patterns';
	import {
		BAND_COLORS,
		genreFacets,
		matchesGenre,
		matchesSearch
	} from '$lib/utils/directory-browse';

	type Tab = 'bands' | 'musicians';

	/** Cards rendered before "Show more" appears. */
	const PAGE_SIZE = 24;

	// Everything seeded from the URL is declared above the top-level await below.
	// Declarations that follow one are async-gated, so they don't exist yet during
	// the first render — the same ordering constraint documented in member/bands.

	// Bands are the public front door, so they're the default and the clean URL;
	// musicians carry `?tab=musicians`. Read from the URL rather than mirrored
	// into it, because the tabs are real links and the URL is the authority.
	// Validate-then-fallback so a junk `?tab=` renders bands, not nothing.
	const tab = $derived<Tab>(
		page.url.searchParams.get('tab') === 'musicians' ? 'musicians' : 'bands'
	);

	// Search and genre are local state, not read back out of `page.url`: deriving
	// them from the URL puts the input a navigation behind the keystroke. Seeded
	// once here, mirrored back by the effect below.
	const initial = page.url.searchParams;
	let searchText = $state(initial.get('q') ?? '');
	let genre = $state(initial.get('genre') ?? '');

	// One unfiltered payload; searching and faceting happen in the browser. See
	// $lib/utils/directory-browse for why, and for what to do if that stops
	// being the right trade.
	const pageData = $derived(await getPublicDirectoryPage());
	const data = $derived(pageData.directory);
	const user = $derived(pageData.viewer);
	const visibility = $derived(pageData.visibility);
	const profileIsHidden = $derived(user && visibility !== 'public');

	const members = $derived(data.members);
	const bands = $derived(data.bands);

	/** Shared by the tab links and the URL mirror, so they can't disagree. */
	function directoryHref(target: Tab, q: string, g: string): ResolvedPathname {
		// Pairs rather than URLSearchParams — the lint rule bans mutable instances
		// of it — and defaults are simply left out so a clean view has a clean URL.
		const pairs: [string, string][] = [];
		if (target === 'musicians') pairs.push(['tab', 'musicians']);
		if (q.trim()) pairs.push(['q', q.trim()]);
		if (g) pairs.push(['genre', g]);

		const search = pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
		// The path is resolved; the query is built above from this page's own
		// filters. `resolve()` cannot check an arbitrary suffix, so the join is
		// asserted here rather than the whole expression being left untyped.
		const base = resolve('/directory');
		return (search ? `${base}?${search}` : base) as ResolvedPathname;
	}

	// Writes the URL, never state — `searchText` and `genre` stay the source of
	// truth. `goto(..., { replaceState })` rather than `replaceState()`: the
	// latter only rewrites the address bar, and the router then overwrites that
	// entry with its own record on the next navigation. Debounced so typing a
	// word costs one rewrite rather than one per character, and `keepFocus` so
	// the rewrite doesn't yank the caret out of the search box mid-word.
	$effect(() => {
		// `tab` is read from the URL here, deliberately. Mirroring a state copy of
		// it would re-push the tab you just left the instant you pressed Back.
		const href = directoryHref(tab, searchText, genre);
		const timer = setTimeout(() => {
			if (location.pathname + location.search !== href) {
				void goto(href, { replaceState: true, noScroll: true, keepFocus: true });
			}
		}, 300);
		return () => clearTimeout(timer);
	});

	function matching<T extends { name: string; genres?: string[] }>(rows: T[]): T[] {
		return rows.filter((r) => matchesSearch(r, searchText) && matchesGenre(r, genre));
	}

	const bandMatches = $derived(matching(bands));
	const musicianMatches = $derived(matching(members));
	const matchCount = $derived(tab === 'bands' ? bandMatches.length : musicianMatches.length);

	// Facets come off the search-filtered but genre-*un*filtered set, so every
	// chip on offer still leads somewhere.
	const searched = $derived(
		(tab === 'bands' ? bands : members).filter((r) => matchesSearch(r, searchText))
	);
	const facets = $derived(genreFacets(searched));
	// Keep the selected genre clickable even when this tab doesn't otherwise
	// offer it, or there'd be no way to switch it off.
	const chips = $derived(genre && !facets.includes(genre) ? [genre, ...facets] : facets);

	// The "Show more" window collapses whenever the listed set changes. Derived
	// off a key rather than reset from an effect, so it can never lag the filters
	// by a frame or expand the tab you just switched to.
	const listKey = $derived(`${tab}\u0000${searchText}\u0000${genre}`);
	let expandedTo = $state(PAGE_SIZE);
	let expandedFor = $state('');
	const limit = $derived(expandedFor === listKey ? expandedTo : PAGE_SIZE);
	// Sliced per tab rather than off a shared `filtered`: a union of band and
	// member rows loses every field that isn't common to both.
	const visibleBands = $derived(bandMatches.slice(0, limit));
	const visibleMusicians = $derived(musicianMatches.slice(0, limit));
	const remaining = $derived(Math.max(0, matchCount - limit));

	function showMore() {
		expandedTo = limit + PAGE_SIZE;
		expandedFor = listKey;
	}

	const hasFilters = $derived(searchText.trim() !== '' || genre !== '');

	function clearFilters() {
		searchText = '';
		genre = '';
	}

	function toggleGenre(value: string) {
		genre = genre === value ? '' : value;
	}

	// Keyed on the band id, not the loop index: an index-keyed colour reshuffles
	// every card in the grid as soon as a filter narrows the list.
	function bandColor(id: string): string {
		return BAND_COLORS[hashIndex(id, BAND_COLORS.length)];
	}
</script>

<svelte:head>
	<title>Directory | Corvallis Music Collective</title>
	<meta name="description" content="Bands and musicians in the Corvallis Music Collective." />
</svelte:head>

{#snippet empty(singular: string, plural: string, total: number)}
	{#if total === 0}
		<EmptyState message="No public {singular} profiles yet." />
	{:else}
		<EmptyState>
			<p>No {plural} match your search.</p>
			<Button variant="ghost" size="sm" class="mt-2" onclick={clearFilters}>Clear filters</Button>
		</EmptyState>
	{/if}
{/snippet}

<Section>
	<div class="mb-8 text-center">
		<h1 class="mb-3 text-4xl font-bold tracking-tight text-cmc-navy">Directory</h1>
		<p class="text-base text-fg-2">Bands and musicians in the Corvallis Music Collective</p>
	</div>

	{#if data.failed}
		<Alert type="error">Couldn't load the directory right now — please refresh the page.</Alert>
	{:else}
		<div class="mb-6 flex justify-center">
			<TabBar
				tabs={[
					{
						key: 'bands',
						label: 'Bands',
						badge: bandMatches.length,
						href: directoryHref('bands', searchText, genre)
					},
					{
						key: 'musicians',
						label: 'Musicians',
						badge: musicianMatches.length,
						href: directoryHref('musicians', searchText, genre)
					},
					{
						// Points at a sibling route rather than a `?tab=`: the reader and
						// the columns both differ. TabBar renders an <a> in URL mode, so
						// cross-route tabs compose with no shared state.
						key: 'instructors',
						label: 'Teachers',
						href: resolve('/directory/instructors')
					}
				]}
				active={tab}
			/>
		</div>

		<div class="mb-10 flex flex-col items-center gap-3">
			<FormField
				type="text"
				name="q"
				label="Search"
				class="w-full max-w-sm"
				placeholder={tab === 'bands' ? 'Search bands by name…' : 'Search musicians by name…'}
				bind:value={searchText}
			/>

			{#if chips.length > 0}
				<div class="flex flex-wrap justify-center gap-1">
					{#each chips as value (value)}
						<Button
							variant="default"
							size="xs"
							class={genre === value ? 'btn-primary' : 'btn-ghost'}
							aria-pressed={genre === value}
							onclick={() => toggleGenre(value)}
						>
							{value}
						</Button>
					{/each}
				</div>
			{/if}

			{#if hasFilters}
				<Button variant="ghost" size="xs" onclick={clearFilters}>Clear filters</Button>
			{/if}
		</div>

		{#if tab === 'bands'}
			{#if matchCount === 0}
				{@render empty('band', 'bands', bands.length)}
			{:else}
				<div class="grid-gallery-tight">
					{#each visibleBands as b (b.id)}
						<VinylCard
							href="/directory/bands/{b.slug}"
							id={b.id}
							name={b.name}
							avatarUrl={b.avatarUrl}
							tagline={b.tagline}
							memberCount={b.memberCount}
							lookingForMembers={b.lookingForMembers}
							color={bandColor(b.id)}
						/>
					{/each}
					{#if !user && remaining === 0}<VinylCardCta />{/if}
				</div>
			{/if}
		{:else if matchCount === 0}
			{@render empty('musician', 'musicians', members.length)}
		{:else}
			<div class="grid-gallery">
				{#each visibleMusicians as member (member.id)}
					<IdCard
						href="/directory/members/{member.id}"
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
						memberSince={new Date(member.memberSince).getFullYear()}
					/>
				{/each}
				{#if !user && remaining === 0}<IdCardCta />{/if}
			</div>
		{/if}

		{#if remaining > 0}
			<div class="mt-8 flex justify-center">
				<Button variant="default" size="sm" outline onclick={showMore}>
					Show more ({remaining} left)
				</Button>
			</div>
		{/if}

		{#if profileIsHidden}
			<p class="mt-10 text-center text-sm text-fg-3">
				Don't see your name? Your profile is set to
				<strong>{visibility === 'hidden' ? 'hidden' : 'members-only'}</strong>.
				<a href={resolve('/member/directory')} class="text-cmc-teal underline"
					>Update your visibility</a
				>
				to appear here.
			</p>
		{/if}
	{/if}
</Section>
