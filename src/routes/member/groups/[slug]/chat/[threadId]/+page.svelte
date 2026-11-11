<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/** One topic of the club or committee's chat, read and written by every member. */
	import { resolve } from '$app/paths';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import GroupChat from '#lib/components/inbox/GroupChat.svelte';
	import { getGroupChatTopic } from '#lib/remote/group-chat.remote.js';
	import { getMemberLayoutContext } from '../../../../layout-context';
	import { routeParams } from '#lib/route-params.svelte.js';

	const params = routeParams('slug', 'threadId');

	const memberLayout = getMemberLayoutContext();
	const slug = $derived(params.slug);
	const threadId = $derived(params.threadId);

	const chat = $derived(await getGroupChatTopic(threadId));
</script>

<PageHeader
	title={m.member_chat_title()}
	crumb={chat.topicName}
	parent={[{ label: m.member_chat_label(), href: resolve('/member/groups/[slug]/chat', { slug }) }]}
/>
<PageContent>
	<GroupChat {chat} viewerUserId={memberLayout.current.user.id} />
</PageContent>
