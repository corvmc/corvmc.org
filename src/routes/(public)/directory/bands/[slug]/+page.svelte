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
	import ShowsBox from '$lib/components/directory/profile/ShowsBox.svelte';
	import CrossRefList, {
		type CrossRef
	} from '$lib/components/directory/profile/CrossRefList.svelte';
	import TagCloud from '$lib/components/directory/profile/TagCloud.svelte';
	import LinksBox from '$lib/components/directory/profile/LinksBox.svelte';
	import ProfileGrid from '$lib/components/directory/profile/ProfileGrid.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import PressBox from '$lib/components/directory/profile/PressBox.svelte';
	import PressPhoto from '$lib/components/directory/profile/PressPhoto.svelte';
	import ContactForm from '$lib/components/directory/profile/ContactForm.svelte';

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
	<div class="profile-page__bar no-print">
		<a href={resolve('/directory')} class="link text-muted">&larr; Back to Directory</a>
		<Button variant="ghost" size="sm" onclick={() => window.print()}>Print / save as PDF</Button>
	</div>

	<ProfileHeader
		avatarShape="square"
		name={band.name}
		{subtitle}
		image={band.avatarUrl}
		{pills}
		primaryAction={{ label: 'Contact for booking', href: '#booking' }}
		{shareUrl}
	/>

	<QuickFacts {facts} />

	<ProfileGrid>
		{#snippet main()}
			<ProseBlock label="About" markdown={band.bio} />
			<ListenStrip links={band.links} />
			<ShowsBox
				upcoming={shows.upcoming}
				past={shows.past}
				pastCount={shows.pastCount}
				pastHasMore={shows.pastHasMore}
				loadMorePast={(offset) => getBandPastShows({ id: band.id, offset })}
				showByline={false}
			/>
			<PressBox quotes={band.pressKit.pressQuotes} achievements={band.pressKit.achievements} />
			<PressPhoto photos={band.photos} />
		{/snippet}
		{#snippet side()}
			<CrossRefList label="Members" items={memberRefs} note={`${band.memberCount} · roles`} />
			<TagCloud label="Genres · Influences" tags={band.genres} />
			<LinksBox links={band.links} />
			<div id="booking">
				<ContactForm slug={band.slug} bandName={band.name} />
			</div>
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
	.profile-page__bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.profile-page__footer {
		text-align: center;
		padding: 16px 0;
		font-size: 12px;
		opacity: 0.4;
	}

	/* ---------------------------------------------------------------------
	 * Printed, this page is the act's press kit.
	 *
	 * That is the whole reason there is no separate `/epk` URL to keep in sync:
	 * a booker is handed `{slug}.corvmc.org`, and the same page they browse is
	 * the one that comes out of the printer. So the rules below are not a
	 * courtesy — they are the deliverable.
	 *
	 * Three things have to go. Anything that navigates is meaningless on paper.
	 * The streaming iframe prints as a grey rectangle, so its section is dropped
	 * and `LinksBox` carries the URLs in text. And the site's own palette is
	 * built for a screen, so the document flattens to black on white rather than
	 * asking a venue to spend its toner on our background.
	 * ------------------------------------------------------------------- */
	@media print {
		:global(.no-print) {
			display: none !important;
		}
		/* The embedded player, and the contact form that replaced the published
		   address — a stranger reading this on paper already has it in their hand. */
		:global(.profile-page :is(iframe, form, button)) {
			display: none !important;
		}
		.profile-page {
			max-width: 100%;
			padding: 0;
			gap: 14px;
			color: #000;
			background: #fff;
		}
		:global(.profile-page .card),
		:global(.profile-page section) {
			box-shadow: none !important;
			border-color: #ccc !important;
			background: #fff !important;
			break-inside: avoid;
		}
		:global(.profile-page a) {
			color: inherit;
			text-decoration: none;
		}
		.profile-page__footer {
			opacity: 1;
		}
	}
</style>
