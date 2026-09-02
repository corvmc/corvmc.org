<script lang="ts">
	/**
	 * One staff conversation — the thread pane of the two-pane inbox.
	 *
	 * The details/status/assignment sidebar this page used to carry is now a
	 * collapsible strip under the header. Three columns (queue │ thread │
	 * sidebar) do not fit at ordinary widths, and of the three the sidebar is the
	 * one you consult rather than read.
	 */
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import ThreadTimeline from '$lib/components/inbox/ThreadTimeline.svelte';
	import ThreadComposer from '$lib/components/inbox/ThreadComposer.svelte';
	import ThreadHeader from '$lib/components/inbox/ThreadHeader.svelte';
	import AssignControl from './AssignControl.svelte';
	import DispositionBar from '$lib/components/inbox/DispositionBar.svelte';
	import { channelIcon, channelLabel } from '$lib/components/inbox/channels';
	import { threadDisplayStatus } from '$lib/components/inbox/thread-status';
	import { isAlwaysEnabledChannel } from '$lib/config';
	import { formatDate, formatDateTime } from '$lib/utils/format';
	import { IconAlarmSnooze, IconSend } from '@tabler/icons-svelte';
	import {
		getInboxThread,
		getInboxEnabledChannels,
		replyToThread,
		addThreadNote,
		assignThread
	} from '$lib/remote/inbox.remote';

	const threadId = $derived(page.params.id!);

	// One await over all three, rather than three awaited deriveds: separate async
	// deriveds resolve at different times and the template can't read the early
	// ones until the last lands, which Svelte reports as a waterfall.
	// The page's one load-bearing query. The channel config and the assignable
	// staff list both load lazily, in the controls that need them — see
	// `custom/no-concurrent-remote-queries`.
	const t = $derived(await getInboxThread(threadId));

	const replyForm = replyToThread.for('reply');
	const noteForm = addThreadNote.for('note');
	const assignForm = assignThread.for('assign');

	const ChannelIcon = $derived(channelIcon(t.channel));

	// `R` and `A` on the DispositionBar hand control back here, because the
	// composer and the assignee select are this page's, not the bar's. The
	// details strip has to open before the assign control inside it can take
	// focus, so `detailsOpen` is state rather than the <details> element's own.
	let detailsOpen = $state(false);
	let composer = $state<HTMLTextAreaElement>();
</script>

<div class="flex h-full min-h-0 flex-col gap-4">
	<ThreadHeader
		title={t.contactUserName ?? t.contactName ?? t.contactEmail ?? 'Conversation'}
		subtitle={t.subject ?? channelLabel(t.channel)}
		backHref="/staff/inbox"
	>
		{#snippet subtitleIcon()}<ChannelIcon size={14} />{/snippet}
		{#snippet actions()}
			<StatusBadge status={threadDisplayStatus(t)} label />
			<DispositionBar
				threadId={t.id}
				status={t.status}
				awaiting={!!t.awaitingReplySince}
				onreply={() => composer?.focus()}
				onassign={() => {
					detailsOpen = true;
				}}
			/>
		{/snippet}

		<!-- Consulted rather than read, so it is closed by default. A plain
		     <details> keeps it keyboard-operable with no JS. -->
		<details class="collapse-arrow collapse rounded-box bg-base-200/50" bind:open={detailsOpen}>
			<summary class="collapse-title min-h-0 py-2 text-sm font-medium">Details</summary>
			<div class="collapse-content flex flex-col gap-3 text-sm">
				<div class="flex flex-wrap gap-x-6 gap-y-1">
					<span><span class="opacity-60">Channel:</span> {channelLabel(t.channel)}</span>
					<span><span class="opacity-60">Messages:</span> {t.messageCount}</span>
					{#if t.contactUserId}
						<span>
							<span class="opacity-60">Member:</span>
							<a href={resolve(`/staff/users/${t.contactUserId}`)} class="link link-primary">
								{t.contactUserName ?? t.contactName}
							</a>
						</span>
					{/if}
					{#if t.contactEmail}
						<span>
							<span class="opacity-60">Email:</span>
							<a href="mailto:{t.contactEmail}" class="link link-primary">{t.contactEmail}</a>
						</span>
					{/if}
					{#if t.contactPhone}
						<span><span class="opacity-60">Phone:</span> {t.contactPhone}</span>
					{/if}
					<span class="opacity-50">Created {formatDateTime(t.createdAt)}</span>
				</div>

				<AssignControl action={assignForm} threadId={t.id} assignedToUserId={t.assignedToUserId} />
			</div>
		</details>
	</ThreadHeader>

	<!-- The age line. Always present, and always the *reason* the thread is in
	     front of you: which of the two clocks is running says more than either
	     date alone. -->
	{#if t.status === 'snoozed' && t.snoozedUntil}
		<p class="flex items-center gap-1.5 text-muted text-sm">
			<IconAlarmSnooze size={14} /> Returns {formatDate(new Date(t.snoozedUntil))}
		</p>
	{:else if t.awaitingReplySince}
		<p class="flex items-center gap-1.5 text-muted text-sm">
			<IconSend size={14} /> Waiting on a reply since {formatDate(new Date(t.awaitingReplySince))}
		</p>
	{/if}

	<div class="min-h-0 flex-1 overflow-y-auto">
		<ThreadTimeline messages={t.messages} notes={t.notes} contactName={t.contactName} />
	</div>

	<!--
		Channel config gates the composer but nothing above the fold needs it, so it
		loads here rather than in the page's query. Keeping it a query the page
		reads directly is also what keeps it fresh: `updateInboxChannelConfig`
		refreshes it, and a wrapper query keyed by thread id could not be.

		Always-on channels deliver through the site itself, so they are never
		disabled: a web thread replies by email to the address the contact form
		captured, and a portal thread's reply is the message row itself.
	-->
	{#await getInboxEnabledChannels() then enabledChannels}
		{@const channelDisabled =
			!isAlwaysEnabledChannel(t.channel) && !enabledChannels.includes(t.channel)}
		{@const replyBlockedReason =
			(t.channel === 'web' || t.channel === 'email') && !t.contactEmail
				? 'This conversation has no contact email, so there is nowhere to send a reply. Leave an internal note instead.'
				: channelDisabled
					? `Replies are turned off for the ${channelLabel(t.channel)} channel.`
					: undefined}
		<div class="flex flex-col gap-2">
			{#if channelDisabled}
				<Alert type="warning" href={resolve('/staff/settings')}>
					The {channelLabel(t.channel)} channel is disabled. Enable it in Settings → Inbox Channels to
					send replies.
				</Alert>
			{/if}

			<ThreadComposer
				threadId={t.id}
				{replyForm}
				{noteForm}
				{replyBlockedReason}
				bind:field={composer}
				onsent={() => getInboxThread(threadId).refresh()}
			/>
		</div>
	{/await}
</div>
