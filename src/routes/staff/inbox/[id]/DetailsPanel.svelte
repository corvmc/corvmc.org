<script lang="ts">
	/**
	 * Who this is, what we already know about them, and where the thread stands.
	 *
	 * Consulted rather than read, so it collapses to one summary line — the line
	 * itself is the useful part on most threads, and expanding is for the ones
	 * where it is not. A plain `<details>` keeps it keyboard-operable with no JS,
	 * and the open state is remembered per thread so a conversation you keep
	 * coming back to opens the way you left it.
	 *
	 * Its own query, awaited inside the expanded half: none of this is needed to
	 * read the conversation, and four more tables is a round trip the thread pane
	 * should not wait on.
	 */
	import { resolve } from '$app/paths';
	import { IconX } from '@tabler/icons-svelte';
	import type { RemoteForm } from '@sveltejs/kit';
	import SectionLabel from '$lib/components/ui/SectionLabel.svelte';
	import AssignControl from './AssignControl.svelte';
	import { channelLabel } from '$lib/components/inbox/channels';
	import { formatDate, formatDateTime } from '$lib/utils/format';
	import {
		getInboxThreadContext,
		addInboxThreadTag,
		removeInboxThreadTag
	} from '$lib/remote/inbox.remote';

	type Thread = {
		id: string;
		channel: string;
		contactName: string | null;
		contactEmail: string | null;
		contactPhone: string | null;
		contactUserId: string | null;
		contactUserName: string | null;
		assignedToUserId: string | null;
		assignedToName: string | null;
		messageCount: number;
		lastOutboundAt: Date | null;
		createdAt: Date;
	};

	let {
		thread,
		assignForm,
		open = $bindable(false)
	}: {
		thread: Thread;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		assignForm: RemoteForm<any, any> | Omit<RemoteForm<any, any>, 'for'>;
		open?: boolean;
	} = $props();

	const STORAGE_KEY = 'inbox:details-open';

	// Per thread, not global: the strip is worth keeping open on the conversation
	// you are chasing and not on the next one you glance at.
	$effect(() => {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			open = raw ? (JSON.parse(raw) as string[]).includes(thread.id) : false;
		} catch {
			// A browser refusing storage is not a reason to fail to render.
		}
	});

	function remember(next: boolean) {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			// A plain array, not a Set: the lint rule bans mutable built-in
			// collections in Svelte files, and this one is neither reactive nor big.
			const ids = (raw ? (JSON.parse(raw) as string[]) : []).filter((id) => id !== thread.id);
			if (next) ids.push(thread.id);
			// Bounded: this is a convenience, not a record, and an unbounded list of
			// every thread ever opened is not one.
			localStorage.setItem(STORAGE_KEY, JSON.stringify(ids.slice(-50)));
		} catch {
			// Same.
		}
	}

	let newTag = $state('');
</script>

<details
	class="collapse-arrow collapse rounded-box bg-base-200/50"
	bind:open
	ontoggle={(e) => remember((e.currentTarget as HTMLDetailsElement).open)}
>
	<summary class="collapse-title min-h-0 py-2 text-sm font-medium">
		Details
		<span class="ml-2 text-subtle font-normal">
			{thread.contactUserName ??
				thread.contactName ??
				thread.contactEmail ??
				channelLabel(thread.channel)}
			{#if thread.assignedToName}· assigned to {thread.assignedToName}{/if}
		</span>
	</summary>

	<div class="collapse-content flex flex-col gap-4 text-sm">
		{#if open}
			<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				<div class="flex flex-col gap-1">
					<SectionLabel label="Contact" />
					{#if thread.contactUserId}
						<a href={resolve(`/staff/users/${thread.contactUserId}`)} class="link link-primary">
							{thread.contactUserName ?? thread.contactName}
						</a>
					{:else if thread.contactName}
						<span>{thread.contactName}</span>
					{/if}
					{#if thread.contactEmail}
						<a href="mailto:{thread.contactEmail}" class="link truncate link-primary">
							{thread.contactEmail}
						</a>
					{/if}
					{#if thread.contactPhone}<span>{thread.contactPhone}</span>{/if}
				</div>

				<div class="flex flex-col gap-1">
					<SectionLabel label="History" />
					{#await getInboxThreadContext(thread.id)}
						<span class="loading loading-xs loading-spinner"></span>
					{:then context}
						<span>
							{context.priorConversations === 0
								? 'No other conversations'
								: `${context.priorConversations} previous conversation${context.priorConversations === 1 ? '' : 's'}`}
						</span>
						<span class="text-subtle">First contact {formatDate(context.firstContactAt)}</span>
						<span class="text-subtle">Source: {channelLabel(thread.channel)}</span>
					{/await}
				</div>

				<div class="flex flex-col gap-1">
					<SectionLabel label="This thread" />
					<span>{thread.messageCount} message{thread.messageCount === 1 ? '' : 's'}</span>
					<span class="text-subtle">
						{thread.lastOutboundAt
							? `Last reply ${formatDateTime(thread.lastOutboundAt)}`
							: 'Never answered'}
					</span>
					<span class="text-subtle">Opened {formatDate(thread.createdAt)}</span>
				</div>

				<div class="flex flex-col gap-1">
					<SectionLabel label="Tags" />
					<!-- The same query as History; the remote layer dedupes it, and
					     splitting the columns apart is what makes each one readable. -->
					{#await getInboxThreadContext(thread.id) then context}
						<div class="flex flex-wrap items-center gap-1">
							{#each context.tags as tag (tag)}
								<span class="badge gap-1 badge-ghost badge-sm">
									{tag}
									<button
										type="button"
										class="cursor-pointer opacity-50 hover:opacity-100"
										aria-label="Remove tag {tag}"
										onclick={() => removeInboxThreadTag({ threadId: thread.id, tag })}
									>
										<IconX size={11} />
									</button>
								</span>
							{/each}
							<!-- A bare input rather than FormField: this is not a form
							     submission, it is a command fired on Enter, and there is no
							     validation state to show. -->
							<input
								class="input w-24 input-xs"
								placeholder="add"
								aria-label="Add a tag"
								bind:value={newTag}
								onkeydown={(e) => {
									if (e.key !== 'Enter' || !newTag.trim()) return;
									e.preventDefault();
									void addInboxThreadTag({ threadId: thread.id, tag: newTag.trim() });
									newTag = '';
								}}
							/>
						</div>
					{/await}
				</div>
			</div>

			<AssignControl
				action={assignForm}
				threadId={thread.id}
				assignedToUserId={thread.assignedToUserId}
			/>
		{/if}
	</div>
</details>
