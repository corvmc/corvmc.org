<script lang="ts">
	/**
	 * The member's conversations — staff threads and member threads in one list.
	 *
	 * One list is possible because both kinds are participant-based, so
	 * `listMemberConversations` returns them from a single query. Rows are
	 * conversation cards rather than table rows: a table wants columns of
	 * comparable values, and what matters here is who, what they last said, and
	 * whether it is waiting on you.
	 */
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { relativeDay } from '$lib/utils/format';
	import { channelIcon, channelLabel } from '$lib/components/inbox/channels';
	import DataList from '$lib/components/shared/DataList.svelte';
	import ComposeAction from './ComposeAction.svelte';
	import { getMyMessages } from '$lib/remote/direct-messages.remote';
	import { getMemberLayout } from '$lib/remote/layout.remote';
	import { conversationList } from './list-state.svelte';

	// The page number is shared module state, not local: the thread pane is a
	// sibling, and it has to be able to refresh this list at the page it is
	// actually showing. See list-state.svelte.ts.
	const result = $derived(getMyMessages({ page: conversationList.page }));
	const layout = $derived(await getMemberLayout());
	const openId = $derived(page.params.id);
</script>

<div class="flex min-h-0 flex-col gap-3">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<h1 class="text-xl font-bold">Messages</h1>
		<div class="flex flex-wrap gap-2">
			<ComposeAction canMessageMembers={layout.features.directMessages} />
		</div>
	</div>

	<!--
		Requests are deliberately absent from the nav badge — an unconsented message
		must not follow anyone around the site — so this is the only place that says
		some are waiting. `getMemberLayout` has returned the count all along with
		nothing rendering it.
	-->
	{#if layout.pendingRequests > 0}
		<p class="text-muted text-sm">
			{layout.pendingRequests}
			{layout.pendingRequests === 1 ? 'message request is' : 'message requests are'} waiting for you.
		</p>
	{/if}

	<div class="min-h-0 flex-1 overflow-y-auto">
		<DataList
			{result}
			emptyTitle="No messages yet"
			empty="Start a conversation and it will appear here."
			onpage={(p) => (conversationList.page = p)}
		>
			{#snippet children(conversations)}
				<ul class="flex flex-col gap-1">
					{#each conversations as c (c.id)}
						{@const href = resolve(`/member/messages/${c.id}`)}
						{@const Icon = channelIcon(c.channel)}
						{@const active = c.id === openId}
						<li>
							<a
								{href}
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
										<span class="truncate font-medium" class:font-bold={c.unread}>
											{c.channel === 'direct'
												? (c.counterpartName ?? 'Member')
												: (c.subject ?? 'Conversation')}
										</span>
										{#if c.pending}
											<span class="badge badge-sm badge-warning shrink-0">Request</span>
										{/if}
										{#if c.unread}
											<span class="bg-primary size-2 shrink-0 rounded-full" title="Unread"></span>
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
			{/snippet}
		</DataList>
	</div>
</div>
