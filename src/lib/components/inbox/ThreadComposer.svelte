<script lang="ts">
	import CardBody from '$lib/components/shared/Card/CardBody.svelte';
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
	import Form from '$lib/components/shared/Form/Form.svelte';
	import FormField from '$lib/components/shared/Form/FormField.svelte';
	import SubmitButton from '$lib/components/shared/Form/SubmitButton.svelte';
	import TabBar from '$lib/components/shared/TabBar.svelte';

	let {
		threadId,
		replyForm,
		noteForm,
		/** Why replying is impossible, if it is. Set = the Reply tab is disabled. */
		replyBlockedReason,
		onsent
	}: {
		threadId: string;
		replyForm: Omit<RemoteForm<{ threadId: string; body: string }, unknown>, 'for'>;
		/** Omitted on member-facing timelines: internal notes are staff-only. */
		noteForm?: Omit<RemoteForm<{ threadId: string; body: string }, unknown>, 'for'>;
		replyBlockedReason?: string;
		onsent?: () => void;
	} = $props();

	let requestedMode = $state<'reply' | 'note'>('reply');
	let draft = $state('');

	// When replying is impossible the composer is a note box regardless of what
	// was last picked — a channel can be disabled while the page is open, and the
	// draft should not end up pointed at a target it can't reach. With no note
	// form there is nowhere else to go, so it stays a reply box and the caller is
	// expected to have hidden it (the member page shows an Alert instead).
	const isNote = $derived(!!noteForm && (requestedMode === 'note' || !!replyBlockedReason));
	const mode = $derived(isNote ? 'note' : 'reply');
	const activeForm = $derived(isNote && noteForm ? noteForm : replyForm);
</script>

<div
	class="card border {isNote ? 'border-warning/40 bg-warning/5' : 'border-base-300 bg-base-100'}"
>
	<CardBody padding="sm" class="gap-3">
		{#if noteForm}
			<div class="flex flex-wrap items-center justify-between gap-2">
				<TabBar
					tabs={[
						{ key: 'reply', label: 'Reply' },
						{ key: 'note', label: 'Internal note' }
					]}
					active={mode}
					onchange={(key) => {
						if (key === 'reply' && replyBlockedReason) return;
						requestedMode = key as 'reply' | 'note';
					}}
				/>
				{#if isNote}
					<span class="flex items-center gap-1 text-subtle">
						<IconNote size={14} /> Staff only — the contact never sees this
					</span>
				{/if}
			</div>
		{/if}

		{#if replyBlockedReason}
			<p class="text-warning text-xs">{replyBlockedReason}</p>
		{/if}

		<Form
			remote={activeForm}
			successToast={isNote ? 'Note added' : 'Reply sent'}
			onsuccess={() => {
				draft = '';
				onsent?.();
			}}
			class="flex flex-col gap-2"
		>
			<input {...activeForm.fields.threadId.as('hidden', threadId)} />
			<!-- The `input` snippet rather than `type="textarea"`: that branch spreads
			     only `inputProps`, so `rows` and `placeholder` were silently dropped and
			     the box has been sized wrong since this was written. -->
			<FormField name="body" label="">
				{#snippet input(id)}
					<textarea
						{id}
						name="body"
						class="textarea w-full"
						rows={isNote ? 2 : 4}
						placeholder={isNote ? 'Add an internal note…' : 'Type your reply…'}
						bind:value={draft}
					></textarea>
				{/snippet}
			</FormField>
			<div class="flex justify-end">
				<SubmitButton
					label={isNote ? 'Add Note' : 'Send Reply'}
					successLabel={isNote ? 'Added' : 'Sent'}
					shortcut="mod+enter"
					disabled={!draft.trim()}
					class={isNote ? 'btn-neutral' : 'btn-primary'}
				>
					{#snippet icon()}
						{#if isNote}<IconNote size={16} />{:else}<IconSend size={16} />{/if}
					{/snippet}
				</SubmitButton>
			</div>
		</Form>
	</CardBody>
</div>
