<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { env } from '$env/dynamic/public';
	import { canonicalAddress } from '$lib/utils/canonical-address';
	import { getDirectoryMember, getMemberPastShows } from '$lib/remote/directory.remote';
	import { ReportContentAction } from '$lib/components/actions';
	import MessageMemberAction from './MessageMemberAction.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import { pageTitle } from '$lib/config';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Button from '$lib/components/ui/Button.svelte';
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
	import type { ProfileLink, DirectoryContact } from '$lib/server/db/schema/authentication';

	const BANDS_BASE = '/member/directory/bands';

	let id = $derived(page.params.id!);
	// One query — see the note on `getDirectoryMember`. The two permission flags are decided
	// server-side now; the "message yourself" reasoning moved there with them.
	let data = $derived(await getDirectoryMember(id));

	const member = $derived(data.profile);
	const shows = $derived(data.shows);
	const canReport = $derived(data.viewer.canReport);
	const canMessage = $derived(data.viewer.canMessage);

	let links = $derived((member?.links as ProfileLink[] | null) ?? []);
	let contact = $derived((member?.directoryContact ?? {}) as NonNullable<DirectoryContact>);

	// `/m/{memberNumber}` — the member's address, rather than this members-only
	// path. Null for an account the backfill has not reached, and then the share
	// button falls back to the current URL.
	const shareUrl = $derived(
		canonicalAddress(
			{ kind: 'member', memberNumber: member?.memberNumber },
			{ siteUrl: env.PUBLIC_SITE_URL }
		)
	);

	let subtitle = $derived(member?.tagline || member?.instruments?.join(' · ') || null);

	let pills = $derived.by<ProfilePill[]>(() => {
		if (!member) return [];
		const p: ProfilePill[] = [];
		if (member.memberNumber != null)
			p.push({ label: `Member · #${String(member.memberNumber).padStart(4, '0')}` });
		if (member.lookingForBand) p.push({ label: 'Looking to join an act', variant: 'warm' });
		if (member.availableForHire) p.push({ label: 'Available for hire' });
		if (member.teachesLessons) p.push({ label: 'Teaches privately' });
		if (member.openToCollaboration) p.push({ label: 'Open to collaboration' });
		return p;
	});

	let facts = $derived(
		member
			? [
					{ label: 'Joined', value: String(new Date(member.createdAt).getFullYear()) },
					{ label: 'Pronouns', value: member.pronouns },
					{ label: 'Based in', value: member.hometown },
					{ label: 'Looking for', value: member.lookingForBand ? 'An act to join' : null }
				]
			: []
	);

	let bandRefs = $derived<CrossRef[]>(
		(member?.bands ?? []).map((b) => ({
			name: b.name,
			sub: b.position ?? (b.role === 'owner' || b.role === 'admin' ? 'Leader' : null),
			href: `${BANDS_BASE}/${b.slug}`,
			image: b.avatarUrl,
			avatarShape: 'square'
		}))
	);

	let tags = $derived([...(member?.instruments ?? []), ...(member?.genres ?? [])]);
</script>

<!-- Leads with ProfileHeader rather than PageHeader, so the title is set here. -->
<svelte:head>
	{#if member}
		<title>{pageTitle(member.name)}</title>
	{/if}
</svelte:head>

{#if member}
	<PageContent width="3xl">
		<div class="flex items-center justify-between">
			<a href={resolve('/member/directory')} class="link text-muted">&larr; Back to Directory</a>
			<div class="flex items-center gap-2">
				{#if canMessage}
					<MessageMemberAction recipientId={id} recipientName={member.name} />
				{/if}
				{#if canReport}
					<ReportContentAction
						entityType="member_profile"
						entityId={id}
						entityLabel={member.name}
					/>
				{/if}
			</div>
		</div>

		<ProfileHeader
			avatarShape="round"
			name={member.name}
			{subtitle}
			image={member.image}
			{pills}
			{shareUrl}
		/>

		<QuickFacts {facts} />

		<ProfileGrid>
			{#snippet main()}
				<ProseBlock label="Bio" markdown={member.bio} />
				<ListenStrip {links} />
				<ShowsBox
					upcoming={shows.upcoming}
					past={shows.past}
					pastCount={shows.pastCount}
					pastHasMore={shows.pastHasMore}
					loadMorePast={(offset) => getMemberPastShows({ id, offset })}
					eventBase="/member/events"
					bandBase={BANDS_BASE}
				/>
			{/snippet}
			{#snippet side()}
				<CrossRefList label="Acts" items={bandRefs} note={`${bandRefs.length} active`} />
				<TagCloud label="Plays · Genres" {tags} />
				<LinksBox {links} />
				<ContactBox label="Contact" {contact} />
			{/snippet}
		</ProfileGrid>
	</PageContent>
{:else}
	<Alert type="warning">
		Member not found or profile is hidden.
		{#snippet action()}
			<Button href="/member/directory" variant="default" size="sm">Back to Directory</Button>
		{/snippet}
	</Alert>
{/if}
