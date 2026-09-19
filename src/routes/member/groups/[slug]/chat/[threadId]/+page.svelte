<script lang="ts">
	/** One topic of the club or committee's chat, read and written by every member. */
	import { page } from '$app/state';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import GroupChat from '$lib/components/inbox/GroupChat.svelte';
	import { getMemberLayoutContext } from '../../../../layout-context';

	const memberLayout = getMemberLayoutContext();
	const slug = $derived(page.params.slug!);
	const threadId = $derived(page.params.threadId!);
</script>

<PageHeader title="Chat" backHref="/member/groups/{slug}/chat" />
<PageContent>
	<GroupChat {threadId} viewerUserId={memberLayout.current.user.id} />
</PageContent>
