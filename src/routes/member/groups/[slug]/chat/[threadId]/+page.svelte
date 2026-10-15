<script lang="ts">
	/** One topic of the club or committee's chat, read and written by every member. */
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import GroupChat from '$lib/components/inbox/GroupChat.svelte';
	import { getGroupChatTopic } from '$lib/remote/group-chat.remote';
	import { getMemberLayoutContext } from '../../../../layout-context';

	const memberLayout = getMemberLayoutContext();
	const slug = $derived(page.params.slug!);
	const threadId = $derived(page.params.threadId!);

	const chat = $derived(await getGroupChatTopic(threadId));
</script>

<PageHeader
	title="Chat"
	crumb={chat.topicName}
	parent={[{ label: 'Chat', href: resolve('/member/groups/[slug]/chat', { slug }) }]}
/>
<PageContent>
	<GroupChat {chat} viewerUserId={memberLayout.current.user.id} />
</PageContent>
