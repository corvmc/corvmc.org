<script lang="ts">
	/**
	 * The rows of a conversation list, shared by the member's Messages and a
	 * band's pre-filtered view of the same query (#1250).
	 *
	 * Cards, not table rows: what matters is who wrote, what they last said and
	 * whether it waits on you. No entity ref — the whole row is the anchor.
	 */
	import type { ResolvedPathname } from '$app/types';
	import { page } from '$app/state';
	import { relativeDay } from '$lib/utils/format';
	import { channelIcon, channelLabel } from './channels';
	import type { UnifiedConversation } from '$lib/types/conversation';

	let {
		rows,
		hrefFor,
		showInbox = true
	}: {
		rows: UnifiedConversation[];
		hrefFor: (id: string) => string;
		/** Off where every row is in the same inbox, so the badge says nothing. */
		showInbox?: boolean;
	} = $props();

	const openId = $derived(page.params.id);

	function titleOf(c: UnifiedConversation): string {
		if (c.channel === 'group') return 'Group chat';
		if (c.channel === 'direct') return c.counterpartName ?? 'Member';
		return c.subject ?? c.counterpartName ?? 'Conversation';
	}
</script>

<ul class="flex flex-col gap-1">
	{#each rows as c (c.id)}
		{@const Icon = channelIcon(c.channel)}
		{@const active = c.id === openId}
		<li>
			<a
				href={hrefFor(c.id) as ResolvedPathname}
				class="flex items-start gap-3 rounded-box p-3 hover:bg-base-200 {active
					? 'bg-base-200'
					: ''}"
				aria-current={active ? 'page' : undefined}
			>
				<span class="mt-0.5 shrink-0 opacity-60" title={channelLabel(c.channel)}>
					<Icon size={18} />
				</span>

				<span class="flex min-w-0 flex-1 flex-col gap-0.5">
					<span class="flex items-center gap-2">
						<span class="truncate font-medium" class:font-bold={c.unread}>{titleOf(c)}</span>
						{#if c.pending}
							<span class="badge shrink-0 badge-sm badge-warning">Request</span>
						{/if}
						{#if showInbox && c.groupName}
							<!-- Which inbox, on the row rather than only in the filter: a
							     mixed stream has to say where each line came from. -->
							<span class="badge shrink-0 badge-ghost badge-sm">{c.groupName}</span>
						{/if}
						{#if c.unread}
							<span class="size-2 shrink-0 rounded-full bg-primary" title="Unread"></span>
						{/if}
					</span>

					{#if c.preview}
						<span class="truncate text-muted text-sm">{c.preview}</span>
					{/if}

					<span class="text-subtle text-xs">
						{c.lastMessageAt ? relativeDay(c.lastMessageAt) : '—'}
						{#if c.status === 'resolved'}· Closed{/if}
					</span>
				</span>
			</a>
		</li>
	{/each}
</ul>
