<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import AnnouncementList from '$lib/components/groups/AnnouncementList.svelte';
	import MuteAnnouncementsAction from '$lib/components/groups/MuteAnnouncementsAction.svelte';
	import { getBandAnnouncementsPage } from '$lib/remote/announcements.remote';
	import { getBandLayoutContext } from '../layout-context';

	/**
	 * The band panel's half of "one implementation, two mount points" — the same
	 * `AnnouncementList` the club page mounts as a tab, in a frame instead.
	 *
	 * The layout above already holds the band, so this page adds exactly one
	 * query of its own. Both halves of what it returns are keyed by the same band
	 * id, and `canManage` is decided server-side where the role already is.
	 */
	const bandLayout = getBandLayoutContext();
	const layout = $derived(bandLayout.current);

	const data = $derived(await getBandAnnouncementsPage(layout.band.id));
</script>

<PageHeader title="Announcements" subtitle="Posts to everyone on the roster.">
	<!-- Null for a staff non-member, who has no roster row to mute. -->
	{#if data.notifyAnnouncements !== null}
		<MuteAnnouncementsAction
			groupId={layout.band.id}
			groupName={layout.band.name}
			muted={!data.notifyAnnouncements}
		/>
	{/if}
</PageHeader>

<PageContent width="3xl">
	<AnnouncementList
		groupId={layout.band.id}
		announcements={data.announcements}
		canManage={data.canManage}
	/>
</PageContent>
