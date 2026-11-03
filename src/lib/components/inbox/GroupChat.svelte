<script lang="ts" module>
	import type { getGroupChatTopic as topicQuery } from '#lib/remote/group-chat.remote.js';

	export type GroupChatTopic = Awaited<ReturnType<typeof topicQuery>>;
</script>

<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/**
	 * One topic of a group's chat, whichever panel it is mounted in.
	 *
	 * `ThreadTimeline` in **viewer** mode: a chat is a room of named people, so
	 * your messages sit right and everyone else's left. The enquiry pane is the
	 * opposite — a band answering an outsider — so the two share the timeline
	 * and not its configuration (#1252).
	 */
	import ThreadTimeline from './ThreadTimeline.svelte';
	import MuteRoomAction from './MuteRoomAction.svelte';
	import ThreadComposer from './ThreadComposer.svelte';
	import { untrack } from 'svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import { markGroupChatSeen, postGroupChatMessage } from '#lib/remote/group-chat.remote.js';

	// Handed in, never awaited here: on Messages the page's own query already
	// carries the topic.
	let { chat, viewerUserId }: { chat: GroupChatTopic; viewerUserId: string } = $props();

	// The id alone, so a refreshed topic (a new object) does not re-mark it.
	const threadId = $derived(chat.id);

	// Opening a topic is what clears its dot. Fire-and-forget: a failed mark is
	// a dot that stays lit, which is not worth interrupting the reader for.
	// `untrack` because calling a command reads and writes kit's own pending
	// count, which would make this effect re-run itself (#1956).
	$effect(() => {
		const id = threadId;
		untrack(() => void markGroupChatSeen(id).catch(() => {}));
	});
</script>

<div class="flex h-full min-h-0 flex-col gap-4">
	<div class="flex items-center justify-end">
		<MuteRoomAction threadId={chat.id} roomName={chat.topicName} muted={chat.muted} />
	</div>

	<div class="min-h-0 flex-1 overflow-y-auto">
		{#if chat.messages.length === 0}
			<EmptyState
				title={m.inbox_group_chat_title()}
				description={chat.isGeneral
					? m.inbox_group_chat_s_own_thread_everyone_group({ groupName: chat.groupName })
					: m.inbox_group_chat_empty_everyone_reads({
							topicName: chat.topicName,
							groupName: chat.groupName
						})}
			/>
		{:else}
			<ThreadTimeline messages={chat.messages} {viewerUserId} />
		{/if}
	</div>

	<ThreadComposer
		threadId={chat.id}
		replyForm={postGroupChatMessage}
		sendLabel={m.inbox_group_chat_send_label()}
	/>
</div>
