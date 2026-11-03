<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	/**
	 * One box for both outbound replies and internal notes.
	 *
	 * The two used to be separate forms — one always visible, one behind a toggle —
	 * which meant two textareas doing the same job and a decision to make before
	 * you started typing. Here the draft is owned by the component and the mode
	 * only decides where it gets sent, so switching mid-sentence keeps the text.
	 *
	 * Both modes submit through the same `<Form>`; only the `remote` prop swaps.
	 * `Form` derives its enhance attributes, and both branches render the same
	 * `<form>` element, so the textarea is never remounted. That also buys the
	 * pending state for free: `SubmitButton` spins and disables for the whole
	 * round-trip, which for an email reply is a real wait.
	 *
	 * With no `noteForm` it is a plain reply box, which is what the member side
	 * uses: notes are staff-private, and a member has nothing to switch between.
	 * Sharing the component rather than hand-rolling a second composer is what
	 * keeps the draft handling, the `mod+enter` shortcut and the
	 * disabled-until-non-empty rule in one place.
	 */
	import type { RemoteForm } from '@sveltejs/kit';
	import { IconNote, IconSend } from '@tabler/icons-svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import TabBar from '$lib/components/ui/TabBar.svelte';
	import AssigneeSelect from './AssigneeSelect.svelte';
	import SendOption from './SendOption.svelte';

	let {
		threadId,
		replyForm,
		noteForm,
		/** Why replying is impossible, if it is. Set = the Reply tab is disabled. */
		replyBlockedReason,
		assignees,
		onsent,
		sendLabel = m.inbox_thread_composer_send_label()
	}: {
		threadId: string;
		replyForm: Omit<RemoteForm<{ threadId: string; body: string }, unknown>, 'for'>;
		/** Omitted on member-facing timelines: internal notes are staff-only. */
		noteForm?: Omit<
			RemoteForm<{ threadId: string; body: string; assignToUserId?: string }, unknown>,
			'for'
		>;
		replyBlockedReason?: string;
		/**
		 * The send button's words. "Reply" is wrong in a group chat, where
		 * nobody is replying to anybody in particular (#1252).
		 */
		sendLabel?: string;
		/**
		 * The assignable staff, as a thunk so the composer decides when to fetch
		 * them. Omitted on the member side, which has neither notes nor assignment.
		 */
		assignees?: () => Promise<{ id: string; name: string }[]>;
		onsent?: () => void;
	} = $props();

	let requestedMode = $state<'reply' | 'note'>('reply');
	let draft = $state('');
	let assignTo = $state('');

	// A thread change is a param change, so SvelteKit keeps this component
	// mounted and its state with it — a half-written reply to one member turned
	// up in the reply box of the next thread clicked, one press from the wrong
	// recipient (#978). The conversation changing is what clears it.
	$effect(() => {
		if (threadId) {
			draft = '';
			requestedMode = 'reply';
			assignTo = '';
		}
	});

	// When replying is impossible the composer is a note box regardless of what
	// was last picked — a channel can be disabled while the page is open, and the
	// draft should not end up pointed at a target it can't reach. With no note
	// form there is nowhere else to go, so it stays a reply box and the caller is
	// expected to have hidden it (the member page shows an Alert instead).
	const isNote = $derived(!!noteForm && (requestedMode === 'note' || !!replyBlockedReason));
	const mode = $derived(isNote ? 'note' : 'reply');
	const activeForm = $derived(isNote && noteForm ? noteForm : replyForm);

	// Sending sets a disposition only on the staff side. A member replying in
	// the portal has no queue to move the thread out of, and offering them
	// "Send + resolve" would let them close a conversation staff still owe an
	// answer on. `noteForm` is the same signal that tells the two sides apart
	// everywhere else in this component.
	const staffSend = $derived(!!noteForm && !isNote);
</script>

<div
	class="card border {isNote ? 'border-warning/40 bg-warning/5' : 'border-base-300 bg-base-100'}"
>
	<CardBody padding="sm" class="gap-3">
		{#if noteForm}
			<div class="flex flex-wrap items-center justify-between gap-2">
				<TabBar
					tabs={[
						{ key: 'reply', label: m.inbox_reply() },
						{ key: 'note', label: m.inbox_thread_composer_internal_note() }
					]}
					active={mode}
					onchange={(key) => {
						if (key === 'reply' && replyBlockedReason) return;
						requestedMode = key as 'reply' | 'note';
					}}
				/>
				{#if isNote}
					<span class="flex items-center gap-1 text-subtle">
						<IconNote size={14} />
						{m.inbox_thread_composer_staff_only_contact_never_sees()}
					</span>
				{/if}
			</div>
		{/if}

		{#if replyBlockedReason}
			<p class="text-xs text-warning" data-testid="reply-blocked">{replyBlockedReason}</p>
		{/if}

		<!-- `guard` because every other abandonable form here has one — the profile,
		     the account page, the booking wizard — and a half-written reply left
		     silently on navigate-away or reload (#979). It asks; it does not keep
		     the text. A draft that survives is storage and a clearing rule. -->
		<Form
			guard
			remote={activeForm}
			successToast={isNote
				? m.inbox_thread_composer_note_added()
				: m.inbox_thread_composer_reply_sent()}
			onsuccess={() => {
				draft = '';
				assignTo = '';
				onsent?.();
			}}
			class="flex flex-col gap-2"
		>
			<input {...activeForm.fields.threadId.as('hidden', threadId)} />
			{#if isNote && noteForm}
				<!-- Mention and handover are one action. A note reading "@Miranda can
				     you take this one?" that leaves the thread assigned to whoever
				     wrote it is how a conversation ends up mentioned at somebody who
				     was never actually given it. -->
				<input {...noteForm.fields.assignToUserId.as('hidden', assignTo)} />
			{/if}
			<!-- The `input` snippet rather than `type="textarea"`: that branch spreads
			     only `inputProps`, so `rows` and `placeholder` were silently dropped.
			     Two lines that grow with the draft (`field-sizing`), capped so the
			     timeline above keeps the pane. -->
			<FormField name="body" label="">
				{#snippet input(id)}
					<textarea
						{id}
						name="body"
						class="textarea field-sizing-content max-h-64 min-h-16 w-full"
						rows={2}
						placeholder={isNote
							? m.inbox_thread_composer_add_internal_note()
							: m.inbox_thread_composer_type_reply()}
						bind:value={draft}></textarea>
				{/snippet}
			</FormField>
			<!-- Stacked below sm: three send buttons side by side on a 375px screen
			     are each too narrow to read and too narrow to hit. The design puts
			     them in a sheet there; a full-width column is the same three
			     outcomes in the same order without a second surface to build. -->
			<div
				class="flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end"
			>
				<!-- Sending always sets a disposition — see SendOption. The two
				     alternates sit beside the default rather than behind a menu:
				     they are three answers to one question, and hiding two of them
				     makes the default look like the only option. A note has no
				     disposition to set; it is not a turn in the conversation. -->
				{#if staffSend}
					<!-- Default first below sm, last above it: on a phone the sheet
					     the design draws leads with the default, and a column reads
					     top-down. -->
					<SendOption
						value="resolve"
						label={m.inbox_thread_composer_send_resolve()}
						disabled={!draft.trim()}
						class="order-2 sm:order-none"
					/>
					<SendOption
						value="keep_open"
						label={m.inbox_thread_composer_send_keep_open()}
						disabled={!draft.trim()}
						class="order-3 sm:order-none"
					/>
				{:else if assignees}
					<!-- Its own data: the composer is below the fold and the staff list
					     is a whole extra round trip. -->
					<AssigneeSelect {assignees} bind:value={assignTo} />
				{/if}
				<SubmitButton
					label={isNote
						? assignTo
							? m.inbox_thread_composer_post_note_assign()
							: m.inbox_thread_composer_add_note()
						: staffSend
							? m.inbox_thread_composer_send_wait_reply()
							: sendLabel}
					successLabel={isNote
						? assignTo
							? m.inbox_thread_composer_assigned()
							: m.inbox_thread_composer_added()
						: m.inbox_thread_composer_sent()}
					shortcut="mod+enter"
					title={staffSend ? m.inbox_thread_composer_title() : undefined}
					disabled={!draft.trim()}
					name={staffSend ? 'disposition' : undefined}
					value={staffSend ? 'wait' : undefined}
					class="{isNote ? 'btn-neutral' : 'btn-primary'} order-1 w-full sm:order-none sm:w-auto"
				>
					{#snippet icon()}
						{#if isNote}<IconNote size={16} />{:else}<IconSend size={16} />{/if}
					{/snippet}
				</SubmitButton>
			</div>
		</Form>
	</CardBody>
</div>
