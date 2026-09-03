<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { env } from '$env/dynamic/public';
	import { canonicalAddress } from '$lib/utils/canonical-address';
	import {
		getPublicBandProfile,
		getBandShows,
		getBandPastShows
	} from '$lib/remote/directory.remote';
	import ProfileHeader, {
		type ProfilePill
	} from '$lib/components/directory/profile/ProfileHeader.svelte';
	import QuickFacts from '$lib/components/directory/profile/QuickFacts.svelte';
	import ProseBlock from '$lib/components/directory/profile/ProseBlock.svelte';
	import ListenStrip from '$lib/components/directory/profile/ListenStrip.svelte';
	import ReleasesBox from '$lib/components/directory/profile/ReleasesBox.svelte';
	import ShowsBox from '$lib/components/directory/profile/ShowsBox.svelte';
	import CrossRefList, {
		type CrossRef
	} from '$lib/components/directory/profile/CrossRefList.svelte';
	import TagCloud from '$lib/components/directory/profile/TagCloud.svelte';
	import LinksBox from '$lib/components/directory/profile/LinksBox.svelte';
	import ContactBox from '$lib/components/directory/profile/ContactBox.svelte';
	import ProfileGrid from '$lib/components/directory/profile/ProfileGrid.svelte';

	const MEMBERS_BASE = '/directory/members';

	// `shows` is chained off the profile promise rather than written as a
	// sibling `$derived(await getBandShows(data.band.id))`: in prod builds, a
	// sibling derived reading a rejected async derived surfaces a minified
	// Svelte-internals TypeError to the boundary instead of the 404 message
	// (e2e/directory-profile-404.e2e.ts).
	let { data, shows } = $derived(
		await getPublicBandProfile(page.params.slug!).then(async (profile) => ({
			data: profile,
			shows: await getBandShows(profile.band.id)
		}))
	);

	const band = $derived(data.band);
	const contact = $derived(band.directoryContact ?? {});

	// The band's own address, not the URL of the page showing it. Every band has
	// `{slug}.corvmc.org` free, and that is what the share button should hand out.
	const shareUrl = $derived(
		canonicalAddress({ kind: 'group', slug: band.slug }, { siteUrl: env.PUBLIC_SITE_URL })
	);

	let subtitle = $derived(band.tagline || band.genres.join(' · ') || null);

	let pills = $derived.by<ProfilePill[]>(() => {
		const p: ProfilePill[] = [
			{ label: `${band.memberCount} member${band.memberCount === 1 ? '' : 's'}` }
		];
		if (band.lookingForMembers) p.push({ label: 'Looking for members', variant: 'warm' });
		return p;
	});

	let facts = $derived([
		{ label: 'Formed', value: band.foundedYear },
		{ label: 'Genre', value: band.genres.join(' · ') },
		{ label: 'Based in', value: band.hometown },
		{ label: 'Looking for', value: band.lookingForMembers ? 'Members' : null }
	]);

	let memberRefs = $derived<CrossRef[]>(
		data.members.map((m) => ({
			name: m.userName ?? 'Member',
			sub: m.position ?? (m.role === 'owner' || m.role === 'admin' ? 'Bandleader' : null),
			href: m.private ? null : `${MEMBERS_BASE}/${m.userId}`,
			image: m.userImage,
			avatarShape: 'round',
			private: m.private
		}))
	);
</script>

<svelte:head>
	<title>{band.name} | Corvallis Music Collective</title>
	<meta name="description" content={band.tagline || `${band.name} on Corvallis Music Collective`} />
	<meta property="og:title" content={band.name} />
	<meta
		property="og:description"
		content={band.tagline || `${band.name} on Corvallis Music Collective`}
	/>
	{#if band.avatarUrl}
		<meta property="og:image" content={band.avatarUrl} />
	{/if}
</svelte:head>

<div class="profile-page">
	<a href={resolve('/directory')} class="link text-muted">&larr; Back to Directory</a>

	<ProfileHeader
		avatarShape="square"
		name={band.name}
		{subtitle}
		image={band.avatarUrl}
		{pills}
		primaryAction={contact.email
			? { label: 'Email to book', href: `mailto:${contact.email}` }
			: undefined}
		{shareUrl}
	/>

	<QuickFacts {facts} />

	<ProfileGrid>
		{#snippet main()}
			<ProseBlock label="About" markdown={band.bio} />
			<ListenStrip links={band.links} />
			<ReleasesBox releases={band.releases} bandSlug={band.slug} />
			<ShowsBox
				upcoming={shows.upcoming}
				past={shows.past}
				pastCount={shows.pastCount}
				pastHasMore={shows.pastHasMore}
				loadMorePast={(offset) => getBandPastShows({ id: band.id, offset })}
				showByline={false}
			/>
		{/snippet}
		{#snippet side()}
			<CrossRefList label="Members" items={memberRefs} note={`${band.memberCount} · roles`} />
			<TagCloud label="Genres · Influences" tags={band.genres} />
			<LinksBox links={band.links} />
			<ContactBox label="Booking" {contact} />
		{/snippet}
	</ProfileGrid>

	<footer class="profile-page__footer">
		<a href={resolve('/')}>Corvallis Music Collective</a>
	</footer>
</div>

<style>
	.profile-page {
		max-width: 56rem;
		margin: 0 auto;
		padding: 24px;
		display: flex;
		flex-direction: column;
		gap: 20px;
	}
	.profile-page__footer {
		text-align: center;
		padding: 16px 0;
		font-size: 12px;
		opacity: 0.4;
	}
</style>
