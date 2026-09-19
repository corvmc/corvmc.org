<script lang="ts">
	/**
	 * One topic of the band's chat, in the right pane of its inbox.
	 *
	 * Keyed on the thread rather than the slug: there is more than one room per
	 * group now, and General is simply the one with no name (#1301).
	 */
	import { page } from '$app/state';
	import GroupChat from '$lib/components/inbox/GroupChat.svelte';
	import { getBandLayoutContext } from '../../../layout-context';

	const bandLayout = getBandLayoutContext();
	const threadId = $derived(page.params.threadId!);
</script>

<GroupChat {threadId} viewerUserId={bandLayout.current.user.id} />
