<script lang="ts">
	/**
	 * One booking enquiry, wherever it is read from — the band's own panel or
	 * the member's unified Messages list (#1250).
	 *
	 * `ThreadTimeline` in **direction** mode, no `viewerUserId`: the band is an
	 * organisation here, so a bandmate's reply reads as the band's side rather
	 * than landing beside the booker's. Who wrote it comes from `authorName`.
	 */
	import { IconCheck, IconRotateClockwise } from '@tabler/icons-svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import ThreadTimeline from './ThreadTimeline.svelte';
	import ThreadComposer from './ThreadComposer.svelte';
	import ThreadHeader from './ThreadHeader.svelte';
	import {
		sendBandReply,
		setBandConversationStatus,
		markBandConversationRead
	} from '$lib/remote/band-messages.remote';

	let {
		thread,
		backHref,
		onchanged
	}: {
		thread: {
			id: string;
			status: string;
			contactName: string | null;
			bandName: string;
			messages: Parameters<typeof ThreadTimeline>[1]['messages'];
		};
		backHref: string;
		onchanged?: () => void;
	} = $props();

	const replyForm = sendBandReply.for('reply');
	const closed = $derived(thread.status === 'resolved');

	// Opening it marks it read, once per thread: the command refreshes a nav
	// badge, and an effect that can re-trigger off its own write is how the
	// member version first deadlocked.
	let markedId: string | undefined;
	$effect(() => {
		const id = thread.id;
		if (markedId === id) return;
		markedId = id;
		void markBandConversationRead(id).then(() => onchanged?.());
	});
</script>

<ThreadHeader
	title={thread.contactName ?? 'Booking enquiry'}
	subtitle="Sent through your public booking form"
	{backHref}
>
	{#snippet actions()}
		<StatusBadge status={thread.status} label />
		<Form
			remote={setBandConversationStatus}
			successToast={closed ? 'Enquiry reopened' : 'Enquiry closed'}
			onsuccess={() => onchanged?.()}
		>
			<input {...setBandConversationStatus.fields.threadId.as('hidden', thread.id)} />
			<input
				{...setBandConversationStatus.fields.status.as('hidden', closed ? 'open' : 'resolved')}
			/>
			<SubmitButton label={closed ? 'Reopen' : 'Close'} variant="ghost" size="sm">
				{#snippet icon()}
					{#if closed}<IconRotateClockwise size={16} />{:else}<IconCheck size={16} />{/if}
				{/snippet}
			</SubmitButton>
		</Form>
	{/snippet}
</ThreadHeader>

<div class="min-h-0 flex-1 overflow-y-auto">
	<!-- No `notes`: internal notes are staff-private and a band thread never
	     acquires one. No `viewerUserId`: see the note at the top. -->
	<ThreadTimeline messages={thread.messages} contactName={thread.contactName} />
</div>

<div class="flex flex-col gap-2">
	{#if closed}
		<Alert type="info">
			You closed this enquiry. Reopen it to reply — or if they write back, it reopens itself.
		</Alert>
	{:else}
		<ThreadComposer threadId={thread.id} {replyForm} onsent={() => onchanged?.()} />
		<p class="text-subtle text-xs">
			Your reply goes to {thread.contactName ?? 'them'} as an email from {thread.bandName}. They
			never see your address, and you never see theirs — their answer comes back here.
		</p>
	{/if}
</div>
