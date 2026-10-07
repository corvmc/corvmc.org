<script lang="ts" module>
	import type { getGroupChatTopic as topicQuery } from '$lib/remote/group-chat.remote';

	export type GroupChatTopic = Awaited<ReturnType<typeof topicQuery>>;
</script>

<script lang="ts">
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
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { markGroupChatSeen, postGroupChatMessage } from '$lib/remote/group-chat.remote';

	// Handed in, never awaited here: on Messages the page's own query already
	// carries the topic, and a second query in flight beside it is the
	// suspected cause of #1776's effect_update_depth_exceeded loop.
	let { chat, viewerUserId }: { chat: GroupChatTopic; viewerUserId: string } = $props();

	// The id alone, so a refreshed topic (a new object) does not re-mark it.
	const threadId = $derived(chat.id);

	// Opening a topic is what clears its dot. Fire-and-forget: a failed mark is
	// a dot that stays lit, which is not worth interrupting the reader for.
	$effect(() => {
		void markGroupChatSeen(threadId).catch(() => {});
	});
</script>

<div class="flex h-full min-h-0 flex-col gap-4">
	<div class="flex items-center justify-end">
		<MuteRoomAction threadId={chat.id} roomName={chat.topicName} muted={chat.muted} />
	</div>

	<div class="min-h-0 flex-1 overflow-y-auto">
		{#if chat.messages.length === 0}
			<EmptyState
				title="Nothing here yet"
				description={chat.isGeneral
					? `This is ${chat.groupName}'s own thread — everyone in the group reads it. Say something.`
					: `${chat.topicName} is empty. Everyone in ${chat.groupName} reads it.`}
			/>
		{:else}
			<ThreadTimeline messages={chat.messages} {viewerUserId} />
		{/if}
	</div>

	<ThreadComposer threadId={chat.id} replyForm={postGroupChatMessage} sendLabel="Send" />
</div>
