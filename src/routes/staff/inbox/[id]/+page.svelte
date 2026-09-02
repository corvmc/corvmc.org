<script lang="ts">
	/**
	 * One staff conversation — the thread pane of the two-pane inbox.
	 *
	 * The details/status/assignment sidebar this page used to carry is now a
	 * collapsible strip under the header — see DetailsPanel. Three columns
	 * (queue │ thread │ sidebar) do not fit at ordinary widths, and of the three
	 * the sidebar is the one you consult rather than read.
	 */
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import ThreadTimeline from '$lib/components/inbox/ThreadTimeline.svelte';
	import ThreadComposer from '$lib/components/inbox/ThreadComposer.svelte';
	import ThreadHeader from '$lib/components/inbox/ThreadHeader.svelte';
	import DetailsPanel from './DetailsPanel.svelte';
	import DispositionBar from '$lib/components/inbox/DispositionBar.svelte';
	import { channelIcon, channelLabel } from '$lib/components/inbox/channels';
	import { threadDisplayStatus } from '$lib/components/inbox/thread-status';
	import { isAlwaysEnabledChannel } from '$lib/config';
	import { formatDate } from '$lib/utils/format';
	import { IconAlarmSnooze, IconSend } from '@tabler/icons-svelte';
	import {
		getInboxThread,
		getInboxEnabledChannels,
		replyToThread,
		addThreadNote,
		assignThread,
		getAssignableStaff
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

	// Assign on the DispositionBar hands control back here, because the assignee
	// select is this page's, not the bar's. The details strip has to open before
	// the assign control inside it can take focus, so `detailsOpen` is state
	// rather than the <details> element's own.
	//
	// The bar's Reply is not offered here at all: it exists to put the cursor in
	// a composer the bar does not own, and on this page that composer is the next
	// thing down the screen.
	let detailsOpen = $state(false);
</script>

<div class="flex flex-col gap-4 overflow-y-auto sm:h-full sm:min-h-0 sm:overflow-visible">
	<ThreadHeader
		title={t.contactUserName ?? t.contactName ?? t.contactEmail ?? 'Conversation'}
		subtitle={t.subject ?? channelLabel(t.channel)}
		backHref="/staff/inbox"
	>
		{#snippet subtitleIcon()}<ChannelIcon size={14} />{/snippet}
		{#snippet actions()}
			<StatusBadge status={threadDisplayStatus(t)} label />
			<!-- Above `sm` the exits live in the header, beside the status they
			     change. Below it they move under the composer instead — see the
			     bottom of this file. Three buttons and a badge on a 375px header
			     wrap into ragged lines and put the primary action off the first
			     screen. -->
			<div class="hidden sm:contents">
				<DispositionBar
					threadId={t.id}
					status={t.status}
					awaiting={!!t.awaitingReplySince}
					onassign={() => {
						detailsOpen = true;
					}}
				/>
			</div>
		{/snippet}

		<DetailsPanel thread={t} {assignForm} bind:open={detailsOpen} />
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

	<!-- The timeline gets its own scrollbar only from `sm` up, where the pane is
	     tall enough for one. On a phone the composer and the disposition row take
	     most of the height, and a flex-1 timeline between them collapses to a
	     two-line window onto the conversation — so below `sm` the whole thread
	     pane scrolls as one instead. -->
	<div class="sm:min-h-0 sm:flex-1 sm:overflow-y-auto">
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
				assignees={getAssignableStaff}
				onsent={() => getInboxThread(threadId).refresh()}
			/>

			<!-- The phone's disposition row: under the composer, above the home
			     indicator, equal targets. -->
			<div class="sm:hidden">
				<DispositionBar
					threadId={t.id}
					status={t.status}
					awaiting={!!t.awaitingReplySince}
					variant="stacked"
					onassign={() => {
						detailsOpen = true;
					}}
				/>
			</div>
		</div>
	{/await}
</div>
