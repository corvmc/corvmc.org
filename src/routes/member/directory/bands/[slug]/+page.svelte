<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { env } from '$env/dynamic/public';
	import { canonicalAddress } from '$lib/utils/canonical-address';
	import { getDirectoryBand, getBandPastShows } from '$lib/remote/directory.remote';
	import { ReportContentAction } from '$lib/components/actions';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import { pageTitle } from '$lib/config';
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
	import ContactBox from '$lib/components/directory/profile/ContactBox.svelte';
	import ProfileGrid from '$lib/components/directory/profile/ProfileGrid.svelte';

	const MEMBERS_BASE = '/member/directory/members';

	// One query. Three concurrent ones is what -1V was: past kit 2.64 the component blows up in
	// Svelte's reactivity instead of rendering. `getBandPastShows` below is still its own call,
	// but it fires from the pager's callback, long after first paint.
	let data = $derived(await getDirectoryBand(page.params.slug!));

	const band = $derived(data.band);
	const shows = $derived(data.shows);
	const canReport = $derived(data.viewer.canReport);
	const contact = $derived(band.directoryContact ?? {});

	// The band's own address, not this authenticated path — see the public
	// profile, which shares the same one.
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
			href: `${MEMBERS_BASE}/${m.userId}`,
			image: m.userImage,
			avatarShape: 'round',
			private: m.private
		}))
	);
</script>

<!-- Leads with ProfileHeader rather than PageHeader, so the title is set here. -->
<svelte:head>
	<title>{pageTitle(band.name)}</title>
</svelte:head>

<PageContent width="3xl">
	<div class="flex items-center justify-between">
		<!-- Carries the tab: members are this directory's default, so a bare
		     /member/directory would drop you somewhere other than where you came from. -->
		<a href="{resolve('/member/directory')}?tab=bands" class="link text-muted"
			>&larr; Back to Directory</a
		>
		{#if canReport}
			<ReportContentAction entityType="band_profile" entityId={band.id} entityLabel={band.name} />
		{/if}
	</div>

	<ProfileHeader
		avatarShape="square"
		name={band.name}
		{subtitle}
		image={band.avatarUrl}
		{pills}
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
				eventBase="/member/events"
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
</PageContent>
