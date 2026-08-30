<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import AnnouncementList from '$lib/components/groups/AnnouncementList.svelte';
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

<PageHeader title="Announcements" subtitle="Posts to everyone on the roster." />

<PageContent width="3xl">
	<AnnouncementList
		groupId={layout.band.id}
		announcements={data.announcements}
		canManage={data.canManage}
	/>
</PageContent>
