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
	import StatusBadge from '$lib/components/shared/StatusBadge.svelte';
	import Alert from '$lib/components/shared/Alert.svelte';
	import Form from '$lib/components/shared/Form/Form.svelte';
	import FormField from '$lib/components/shared/Form/FormField.svelte';
	import SubmitButton from '$lib/components/shared/Form/SubmitButton.svelte';
	import ThreadTimeline from '$lib/components/inbox/ThreadTimeline.svelte';
	import ThreadComposer from '$lib/components/inbox/ThreadComposer.svelte';
	import ThreadHeader from '$lib/components/inbox/ThreadHeader.svelte';
	import ThreadStatusActions from '$lib/components/inbox/ThreadStatusActions.svelte';
	import { channelIcon, channelLabel } from '$lib/components/inbox/channels';
	import { threadDisplayStatus } from '$lib/components/inbox/thread-status';
	import { isAlwaysEnabledChannel } from '$lib/config';
	import { formatDateTime } from '$lib/utils/format';
	import {
		getInboxThread,
		replyToThread,
		addThreadNote,
		updateThreadStatus,
		setThreadAwaiting,
		assignThread,
		getInboxEnabledChannels,
		getAssignableStaff
	} from '$lib/remote/inbox.remote';

	const threadId = $derived(page.params.id!);

	// One await over all three, rather than three awaited deriveds: separate async
	// deriveds resolve at different times and the template can't read the early
	// ones until the last lands, which Svelte reports as a waterfall.
	const data = $derived(
		await Promise.all([getInboxThread(threadId), getInboxEnabledChannels(), getAssignableStaff()])
	);
	const t = $derived(data[0]);
	const enabledChannels = $derived(data[1]);
	const staffUsers = $derived(data[2]);

	const replyForm = replyToThread.for('reply');
	const noteForm = addThreadNote.for('note');
	const assignForm = assignThread.for('assign');
	// Separate instances so each status button tracks its own pending state. The
	// snooze modal takes the base form, since `Action` renders its own `<Form>`.
	const resolveForm = updateThreadStatus.for('resolve');
	const reopenForm = updateThreadStatus.for('reopen');
	const snoozeForm = updateThreadStatus;
	const awaitingForm = setThreadAwaiting.for('awaiting');

	const ChannelIcon = $derived(channelIcon(t.channel));

	// Always-on channels deliver through the site itself, so they are never
	// disabled: a web thread replies by email to the address the contact form
	// captured, and a portal thread's reply is the message row itself.
	const channelDisabled = $derived(
		!isAlwaysEnabledChannel(t.channel) && !enabledChannels.includes(t.channel)
	);

	const replyBlockedReason = $derived.by(() => {
		if ((t.channel === 'web' || t.channel === 'email') && !t.contactEmail) {
			return 'This conversation has no contact email, so there is nowhere to send a reply. Leave an internal note instead.';
		}
		if (channelDisabled)
			return `Replies are turned off for the ${channelLabel(t.channel)} channel.`;
		return undefined;
	});

	const staffOptions = $derived([
		{ value: '', label: 'Unassigned' },
		...staffUsers.map((s) => ({ value: s.id, label: s.name }))
	]);
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
			<ThreadStatusActions
				threadId={t.id}
				status={t.status}
				snoozedUntil={t.snoozedUntil}
				awaitingReplySince={t.awaitingReplySince}
				{resolveForm}
				{reopenForm}
				{snoozeForm}
				{awaitingForm}
			/>
		{/snippet}

		<!-- Consulted rather than read, so it is closed by default. A plain
		     <details> keeps it keyboard-operable with no JS. -->
		<details class="collapse-arrow collapse rounded-box bg-base-200/50">
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

				<Form remote={assignForm} successToast="Assignment updated" class="flex items-end gap-2">
					<input {...assignForm.fields.threadId.as('hidden', t.id)} />
					<FormField
						name="userId"
						label="Assigned to"
						type="select"
						options={staffOptions}
						value={t.assignedToUserId ?? ''}
						class="flex-1"
					/>
					<SubmitButton label="Update" variant="default" size="sm" />
				</Form>
			</div>
		</details>
	</ThreadHeader>

	<div class="min-h-0 flex-1 overflow-y-auto">
		<ThreadTimeline messages={t.messages} notes={t.notes} contactName={t.contactName} />
	</div>

	<div class="flex flex-col gap-2">
		{#if channelDisabled}
			<Alert type="warning" href={resolve('/staff/settings')}>
				The {channelLabel(t.channel)} channel is disabled. Enable it in Settings → Inbox Channels to send
				replies.
			</Alert>
		{/if}

		<ThreadComposer
			threadId={t.id}
			{replyForm}
			{noteForm}
			{replyBlockedReason}
			onsent={() => getInboxThread(threadId).refresh()}
		/>
	</div>
</div>
