<script lang="ts">
	/**
	 * One topic of the band's chat, in the right pane of its inbox.
	 *
	 * Keyed on the thread rather than the slug: there is more than one room per
	 * group now, and General is simply the one with no name (#1301).
	 */
	import GroupChat from '#lib/components/inbox/GroupChat.svelte';
	import { getGroupChatTopic } from '#lib/remote/group-chat.remote.js';
	import { getBandAnnouncementsPage } from '#lib/remote/announcements.remote.js';
	import { getBandLayoutContext } from '../../../layout-context';
	import { routeParams } from '#lib/route-params.svelte.js';
	import AnnouncementsRoom from './AnnouncementsRoom.svelte';

	const params = routeParams('slug', 'threadId');

	const bandLayout = getBandLayoutContext();
	const threadId = $derived(params.threadId);
	const band = $derived(bandLayout.current.band);

	// Chained, not a sibling await: the Announcements room also needs its posts,
	// drafts included for a leader (#3229), and only that room asks for them.
	const view = $derived(
		await getGroupChatTopic(threadId).then(async (chat) => ({
			chat,
			announcements: chat.readOnly ? await getBandAnnouncementsPage(band.id) : null
		}))
	);
</script>

{#if view.announcements}
	<AnnouncementsRoom
		threadId={view.chat.id}
		bandId={band.id}
		bandName={band.name}
		data={view.announcements}
		backHref="/band/{params.slug}/messages"
	/>
{:else}
	<GroupChat
		chat={view.chat}
		viewerUserId={bandLayout.current.user.id}
		backHref="/band/{params.slug}/messages"
	/>
{/if}
