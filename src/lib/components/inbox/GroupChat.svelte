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
	import { IconArrowLeft } from '@tabler/icons-svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import SectionLabel from '#lib/components/ui/SectionLabel.svelte';
	import AvatarStack from '#lib/components/ui/AvatarStack.svelte';
	import EntityAvatar from '#lib/components/ui/entity/EntityAvatar.svelte';
	import { markGroupChatSeen, postGroupChatMessage } from '#lib/remote/group-chat.remote.js';

	// Handed in, never awaited here: on Messages the page's own query already
	// carries the topic.
	let {
		chat,
		viewerUserId,
		backHref
	}: {
		chat: GroupChatTopic;
		viewerUserId: string;
		/** In a `ListDetailShell` the list pane is hidden below `lg`: this is the way out. */
		backHref?: string;
	} = $props();

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

<!-- The member list says who reads the room: beside the thread on a wide
     screen, a row of avatars below it otherwise (#3230). -->
<div class="flex h-full min-h-0 flex-col gap-4 xl:flex-row">
	<div class="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
		<div class="flex items-center justify-end">
			{#if backHref}
				<Button
					href={backHref}
					variant="ghost"
					size="sm"
					shape="square"
					class="mr-auto lg:hidden"
					aria-label={m.ui_back_label()}
				>
					<IconArrowLeft size={18} />
				</Button>
			{/if}
			<MuteRoomAction threadId={chat.id} roomName={chat.topicName} muted={chat.muted} />
		</div>

		<div class="min-h-0 flex-1 overflow-y-auto">
			{#if chat.messages.length === 0}
				<EmptyState title={m.inbox_group_chat_title()} />
			{:else}
				<ThreadTimeline messages={chat.messages} channel="group" {viewerUserId} />
			{/if}
		</div>

		{#if !chat.readOnly}
			<ThreadComposer
				threadId={chat.id}
				replyForm={postGroupChatMessage}
				sendLabel={m.inbox_group_chat_send_label()}
			/>
		{/if}
	</div>

	<aside class="flex shrink-0 flex-col gap-2 xl:w-56 xl:overflow-y-auto" data-testid="room-members">
		<SectionLabel label={m.inbox_group_chat_members_label()} count={chat.readers.length} />
		<div class="xl:hidden">
			<AvatarStack items={chat.readers} max={8} shape="round" />
		</div>
		<ul class="hidden flex-col gap-1 xl:flex">
			{#each chat.readers as reader (reader.id)}
				<li class="flex min-w-0 items-center gap-2 px-1 py-1">
					<EntityAvatar
						name={reader.name}
						image={reader.image}
						shape="round"
						size="avatar-sm"
						class="size-7 shrink-0"
					/>
					<span class="min-w-0 truncate text-sm">{reader.name}</span>
				</li>
			{/each}
		</ul>
	</aside>
</div>
