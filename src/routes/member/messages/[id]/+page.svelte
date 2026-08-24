<script lang="ts">
	/**
	 * One conversation, of either kind. The thread pane of the two-pane inbox.
	 *
	 * Three mutually exclusive footers, and the order matters: a pending request
	 * shows Accept / Decline / Report *instead of* a message box, which is what
	 * makes a request exactly one message until it is accepted.
	 */
	import Card from '$lib/components/shared/Card/Card.svelte';
	import CardBody from '$lib/components/shared/Card/CardBody.svelte';
	import { page } from '$app/state';
	import { IconCheck, IconX, IconBan } from '@tabler/icons-svelte';
	import StatusBadge from '$lib/components/shared/StatusBadge.svelte';
	import Alert from '$lib/components/shared/Alert.svelte';
	import Form from '$lib/components/shared/Form/Form.svelte';
	import SubmitButton from '$lib/components/shared/Form/SubmitButton.svelte';
	import ThreadTimeline from '$lib/components/inbox/ThreadTimeline.svelte';
	import ThreadComposer from '$lib/components/inbox/ThreadComposer.svelte';
	import ThreadHeader from '$lib/components/inbox/ThreadHeader.svelte';
	import ReportDirectThreadAction from './ReportDirectThreadAction.svelte';
	import { refreshConversations } from '../list-state.svelte';
	import { sendConversationMessage, markConversationRead } from '$lib/remote/inbox.remote';
	import {
		getMyMessageThread,
		sendDirectMessage,
		acceptDirectRequest,
		declineDirectRequest,
		blockFromThread
	} from '$lib/remote/direct-messages.remote';

	const threadId = $derived(page.params.id!);

	// Deliberately the only query this page awaits. It carries viewerUserId, so
	// there is no second await for the reader's identity — and in particular not
	// getMemberLayout(), which markConversationRead refreshes to update the nav
	// badge. Awaiting a query that this component's own effect invalidates is an
	// effect_update_depth_exceeded loop.
	const t = $derived(await getMyMessageThread(threadId));

	const staffReplyForm = sendConversationMessage.for('reply');
	const directReplyForm = sendDirectMessage.for('reply');

	// A pending request is read-only until it is accepted — that is what makes a
	// request exactly one message. The three actions replace the message box.
	const isRequest = $derived(t.kind === 'direct' && !t.accepted);
	const closed = $derived(t.status === 'resolved');
	const blocked = $derived(t.kind === 'direct' && t.blocked);

	const title = $derived(
		t.kind === 'direct' ? (t.counterpartName ?? 'Member') : (t.subject ?? 'Conversation')
	);

	// Opening the conversation is what marks it read. Guarded so it fires once
	// per conversation: the command refreshes the layout badge and the list, and
	// an effect that can re-trigger itself off its own write is how this page
	// first deadlocked. The refresh lands on the layout's list pane, not here.
	let markedId: string | undefined;
	$effect(() => {
		const id = threadId;
		if (markedId === id) return;
		markedId = id;
		void markConversationRead(id).then(refreshConversations);
	});
</script>

<div class="flex h-full min-h-0 flex-col gap-4">
	<ThreadHeader
		{title}
		subtitle={t.kind === 'direct'
			? 'Your conversation with another member'
			: 'Your conversation with CorvMC staff'}
		backHref="/member/messages"
	>
		{#snippet actions()}
			<StatusBadge status={t.status} label />
		{/snippet}
	</ThreadHeader>

	<div class="min-h-0 flex-1 overflow-y-auto">
		{#if t.kind === 'direct' && t.counterpartDeleted}
			<Alert type="info">This member's account is no longer active.</Alert>
		{/if}

		<ThreadTimeline messages={t.messages} viewerUserId={t.viewerUserId} />
	</div>

	<div class="flex flex-col gap-2">
		{#if isRequest && t.kind === 'direct'}
			<!-- Accept, Decline, Report. Showing the message above is what makes the
			     decision possible — and Report only means something if you can see
			     what you are reporting. -->
			<Card bordered>
				<CardBody padding="sm" class="gap-3">
					<p class="text-muted">
						{t.counterpartName ?? 'This member'} would like to start a conversation with you. They cannot
						send anything else unless you accept.
					</p>
					<div class="flex flex-wrap items-center gap-2">
						<Form
							remote={acceptDirectRequest}
							successToast="Request accepted"
							onsuccess={refreshConversations}
						>
							<input {...acceptDirectRequest.fields.threadId.as('hidden', t.id)} />
							<SubmitButton label="Accept" variant="primary" size="sm">
								{#snippet icon()}<IconCheck size={16} />{/snippet}
							</SubmitButton>
						</Form>

						<!-- Declining blocks them and is never reported back to the sender:
						     from their side this is indistinguishable from an unopened
						     request, which is what makes saying no cost nothing. -->
						<Form
							remote={declineDirectRequest}
							successToast="Request declined"
							onsuccess={refreshConversations}
						>
							<input {...declineDirectRequest.fields.threadId.as('hidden', t.id)} />
							<SubmitButton label="Decline" variant="ghost" size="sm">
								{#snippet icon()}<IconX size={16} />{/snippet}
							</SubmitButton>
						</Form>

						<ReportDirectThreadAction threadId={t.id} />
					</div>
				</CardBody>
			</Card>
		{:else if blocked}
			<Alert type="info">
				This conversation is closed. You can still read it, but neither of you can write here.
			</Alert>
		{:else if closed}
			<Alert type="info">
				This conversation has been closed.
				{#if t.kind === 'staff'}Start a new message if you need anything else.{/if}
			</Alert>
		{:else}
			<!-- No noteForm: internal notes are staff-private, so the shared composer
			     renders as a plain reply box. -->
			<ThreadComposer
				threadId={t.id}
				replyForm={t.kind === 'direct' ? directReplyForm : staffReplyForm}
				onsent={refreshConversations}
			/>
		{/if}

		{#if t.kind === 'direct' && !isRequest && !blocked}
			<!-- Blocking stays available in an open conversation, not just on a
			     request. History survives a block: the person who blocked still needs
			     it if they later decide to report. -->
			<div class="flex justify-end gap-2">
				<ReportDirectThreadAction threadId={t.id} />
				<Form remote={blockFromThread} successToast="Blocked" onsuccess={refreshConversations}>
					<input {...blockFromThread.fields.threadId.as('hidden', t.id)} />
					<SubmitButton label="Block" variant="error" size="sm" outline>
						{#snippet icon()}<IconBan size={16} />{/snippet}
					</SubmitButton>
				</Form>
			</div>
		{/if}
	</div>
</div>
