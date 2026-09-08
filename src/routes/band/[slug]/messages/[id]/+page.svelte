<script lang="ts">
	/**
	 * One booking enquiry. The thread pane of the band's two-pane inbox.
	 *
	 * `ThreadTimeline` is used in **direction mode** — no `viewerUserId` — which
	 * is the staff inbox's mode, not the member inbox's. The band is an
	 * organisation here: a bandmate's reply has to read as the band's side of the
	 * conversation, and passing the viewer would put it on the left beside the
	 * booker's own messages. Who wrote it comes from `authorName` on the bubble.
	 */
	import { page } from '$app/state';
	import { IconCheck, IconRotateClockwise } from '@tabler/icons-svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import ThreadTimeline from '$lib/components/inbox/ThreadTimeline.svelte';
	import ThreadComposer from '$lib/components/inbox/ThreadComposer.svelte';
	import ThreadHeader from '$lib/components/inbox/ThreadHeader.svelte';
	import { refreshEnquiries } from '../list-state.svelte';
	import {
		getBandConversation,
		sendBandReply,
		setBandConversationStatus,
		markBandConversationRead
	} from '$lib/remote/band-messages.remote';

	const slug = $derived(page.params.slug!);
	const threadId = $derived(page.params.id!);

	// Deliberately the only query this page awaits — and in particular not
	// getBandLayout(), which markBandConversationRead refreshes to update the nav
	// badge. Awaiting a query this component's own effect invalidates is an
	// effect_update_depth_exceeded loop.
	const t = $derived(await getBandConversation({ slug, threadId }));

	const replyForm = sendBandReply.for('reply');
	const closed = $derived(t.status === 'resolved');

	// Opening the enquiry is what marks it read. Guarded so it fires once per
	// thread: the command refreshes the layout badge, and an effect that can
	// re-trigger off its own write is how the member version first deadlocked.
	let markedId: string | undefined;
	$effect(() => {
		const id = threadId;
		if (markedId === id) return;
		markedId = id;
		void markBandConversationRead(id).then(() => refreshEnquiries(slug));
	});
</script>

<div class="flex h-full min-h-0 flex-col gap-4">
	<ThreadHeader
		title={t.contactName ?? 'Booking enquiry'}
		subtitle="Sent through your public booking form"
		backHref="/band/{slug}/messages"
	>
		{#snippet actions()}
			<StatusBadge status={t.status} label />
			<Form
				remote={setBandConversationStatus}
				successToast={closed ? 'Enquiry reopened' : 'Enquiry closed'}
				onsuccess={() => refreshEnquiries(slug)}
			>
				<input {...setBandConversationStatus.fields.threadId.as('hidden', t.id)} />
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
		<!-- No `notes`: internal notes are staff-private, and a band thread never
		     acquires one. No `viewerUserId`: see the note at the top. -->
		<ThreadTimeline messages={t.messages} contactName={t.contactName} />
	</div>

	<div class="flex flex-col gap-2">
		{#if closed}
			<Alert type="info">
				You closed this enquiry. Reopen it to reply — or if they write back, it reopens itself.
			</Alert>
		{:else}
			<!-- No noteForm: the shared composer renders as a plain reply box. -->
			<ThreadComposer threadId={t.id} {replyForm} onsent={() => refreshEnquiries(slug)} />
			<p class="text-subtle text-xs">
				Your reply goes to {t.contactName ?? 'them'} as an email from {t.bandName}. They never see
				your address, and you never see theirs — their answer comes back here.
			</p>
		{/if}
	</div>
</div>
