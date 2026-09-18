<script lang="ts">
	/**
	 * The band's own room, in the right pane of its inbox.
	 *
	 * Chat and enquiries are two conversations with different readers — every
	 * active member here, admins only next door — so they stay two lists. They
	 * are on one page because a member should not have to know which of two
	 * nav rows a message arrived on.
	 */
	import { page } from '$app/state';
	import GroupChat from '$lib/components/inbox/GroupChat.svelte';
	import { getBandLayoutContext } from '../../layout-context';

	const bandLayout = getBandLayoutContext();
	const slug = $derived(page.params.slug!);
</script>

<GroupChat {slug} viewerUserId={bandLayout.current.user.id} />
