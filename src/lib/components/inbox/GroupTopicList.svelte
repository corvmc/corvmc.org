<script lang="ts">
	/**
	 * A group's chat topics, as rows.
	 *
	 * General is pinned first and named rather than left blank — it is the room
	 * you land in, and a landing place that moves is worse than a stale one.
	 * The dot is per topic, which is what `inbox_group_read` already keyed on
	 * before topics existed (#1301).
	 */
	import { IconBellOff } from '@tabler/icons-svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import SectionLabel from '$lib/components/ui/SectionLabel.svelte';
	import NewTopicAction from './NewTopicAction.svelte';
	import { getGroupChatTopics } from '$lib/remote/group-chat.remote';
	// The cast `ConversationRows` already uses: this component serves two
	// panels, so the caller is the one that can name a route.
	import type { ResolvedPathname } from '$app/types';

	let {
		slug,
		hrefFor,
		openThreadId = null
	}: {
		slug: string;
		/** Already resolved by the caller, which is the one that knows its panel. */
		hrefFor: (threadId: string) => string;
		/** Which topic is on screen, so its row reads as current. */
		openThreadId?: string | null;
	} = $props();

	const topics = $derived(await getGroupChatTopics(slug));
</script>

<section>
	<div class="flex items-center justify-between gap-2">
		<SectionLabel label="Chat" count={topics.length} />
		<NewTopicAction {slug} {hrefFor} />
	</div>

	<ul class="flex flex-col">
		{#each topics as topic (topic.id)}
			<li>
				<a
					href={hrefFor(topic.id) as ResolvedPathname}
					aria-current={topic.id === openThreadId ? 'page' : undefined}
					class="flex items-center justify-between gap-2 rounded-lg px-3 py-2 hover:bg-base-200 aria-[current=page]:bg-base-200"
				>
					<span class="min-w-0 truncate" class:font-medium={topic.unread}>{topic.name}</span>
					{#if topic.unread}
						<Badge variant="primary" size="xs">New</Badge>
					{:else if topic.muted}
						<IconBellOff size={14} class="shrink-0 text-base-content/50" aria-label="Muted" />
					{/if}
				</a>
			</li>
		{/each}
	</ul>
</section>
