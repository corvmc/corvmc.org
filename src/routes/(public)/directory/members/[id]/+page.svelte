<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { getPublicMemberProfilePage, getMemberPastShows } from '#lib/remote/directory.remote.js';
	import ProfileHeader, {
		type ProfilePill
	} from '#lib/components/directory/profile/ProfileHeader.svelte';
	import QuickFacts from '#lib/components/directory/profile/QuickFacts.svelte';
	import ProseBlock from '#lib/components/directory/profile/ProseBlock.svelte';
	import ListenStrip from '#lib/components/directory/profile/ListenStrip.svelte';
	import ShowsBox from '#lib/components/directory/profile/ShowsBox.svelte';
	import CrossRefList, {
		type CrossRef
	} from '#lib/components/directory/profile/CrossRefList.svelte';
	import TagCloud from '#lib/components/directory/profile/TagCloud.svelte';
	import LinksBox from '#lib/components/directory/profile/LinksBox.svelte';
	import ContactBox from '#lib/components/directory/profile/ContactBox.svelte';
	import ProfileGrid from '#lib/components/directory/profile/ProfileGrid.svelte';

	const BANDS_BASE = '/directory/bands';

	let id = $derived(page.params.id!);
	const data = $derived(await getPublicMemberProfilePage(id));
	const shows = $derived(data.shows);
	const member = $derived(data.member);

	let subtitle = $derived(member.tagline || member.instruments?.join(' · ') || null);

	let pills = $derived.by<ProfilePill[]>(() => {
		const p: ProfilePill[] = [];
		if (member.lookingForBand)
			p.push({ label: m.public_directory_members_id_looking_band(), variant: 'warm' });
		if (member.availableForHire) p.push({ label: m.public_directory_members_id_available_hire() });
		if (member.teachesLessons) p.push({ label: m.public_directory_members_id_teaches_privately() });
		if (member.openToCollaboration)
			p.push({ label: m.public_directory_members_id_open_collaboration() });
		return p;
	});

	let facts = $derived([
		{ label: m.public_directory_members_id_pronouns(), value: member.pronouns },
		{ label: m.public_based(), value: member.hometown },
		{ label: m.public_looking(), value: member.lookingForBand ? 'A band' : null }
	]);

	let bandRefs = $derived<CrossRef[]>(
		member.bands.map((b) => ({
			name: b.name,
			sub: b.position ?? null,
			href: `${BANDS_BASE}/${b.slug}`,
			image: b.avatarUrl,
			avatarShape: 'square'
		}))
	);

	let tags = $derived([...(member.instruments ?? []), ...(member.genres ?? [])]);
	const contact = $derived(member.directoryContact ?? {});
</script>

<svelte:head>
	<title>{m.public_corvallis_music_collective_2({ name: member.name })}</title>
	<meta
		name="description"
		content={member.tagline || `${member.name} on Corvallis Music Collective`}
	/>
	<meta property="og:title" content={member.name} />
	<meta
		property="og:description"
		content={member.tagline || `${member.name} on Corvallis Music Collective`}
	/>
</svelte:head>

<div class="profile-page">
	<!-- Carries the tab: bands are the directory's default, so a bare /directory
	     would drop you somewhere other than where you came from. -->
	<a href="{resolve('/directory')}?tab=musicians" class="link text-muted"
		>{m.public_back_directory()}</a
	>

	<!-- No `shareUrl`: `toPublicMemberProfile` whitelists the columns it emits and
	     `memberNumber` is deliberately not one of them, so this page cannot build
	     `/m/{n}` and the share button copies the current URL. A member sharing
	     their own address does it from /member/profile, which has the number. -->
	<ProfileHeader avatarShape="round" name={member.name} {subtitle} image={member.image} {pills} />

	<QuickFacts {facts} />

	<ProfileGrid>
		{#snippet main()}
			<ProseBlock kind="bio" markdown={member.bio} />
			<ListenStrip links={member.links} />
			<ShowsBox
				upcoming={shows.upcoming}
				past={shows.past}
				pastCount={shows.pastCount}
				pastHasMore={shows.pastHasMore}
				loadMorePast={(offset) => getMemberPastShows({ id, offset })}
			/>
		{/snippet}
		{#snippet side()}
			<CrossRefList
				kind="bands"
				items={bandRefs}
				note={m.public_directory_members_id_note({ length: bandRefs.length })}
			/>
			<TagCloud label={m.public_directory_members_id_plays_genres()} {tags} />
			<TagCloud label={m.public_directory_members_id_skills()} tags={member.skills ?? []} />
			<LinksBox links={member.links} />
			<ContactBox kind="contact" {contact} />
		{/snippet}
	</ProfileGrid>

	<footer class="profile-page__footer">
		<a href={resolve('/')}>{m.public_corvallis_music_collective()}</a>
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
