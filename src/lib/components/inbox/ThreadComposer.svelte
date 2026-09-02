<script lang="ts">
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
	import Select from '$lib/components/ui/Form/Select.svelte';
	import SendOption from './SendOption.svelte';

	let {
		threadId,
		replyForm,
		noteForm,
		/** Why replying is impossible, if it is. Set = the Reply tab is disabled. */
		replyBlockedReason,
		assignees,
		field = $bindable(),
		onsent
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
		 * The assignable staff, as a thunk so the composer decides when to fetch
		 * them. Omitted on the member side, which has neither notes nor assignment.
		 */
		assignees?: () => Promise<{ id: string; name: string }[]>;
		/**
		 * The textarea itself, so a surface that owns a Reply shortcut can put the
		 * cursor in it. The composer stays the owner of the draft either way.
		 */
		field?: HTMLTextAreaElement;
		onsent?: () => void;
	} = $props();

	let requestedMode = $state<'reply' | 'note'>('reply');
	let draft = $state('');
	let assignTo = $state('');

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
			<p class="text-xs text-warning">{replyBlockedReason}</p>
		{/if}

		<Form
			remote={activeForm}
			successToast={isNote ? 'Note added' : 'Reply sent'}
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
			     only `inputProps`, so `rows` and `placeholder` were silently dropped and
			     the box has been sized wrong since this was written. -->
			<FormField name="body" label="">
				{#snippet input(id)}
					<textarea
						{id}
						bind:this={field}
						name="body"
						class="textarea w-full"
						rows={isNote ? 2 : 4}
						placeholder={isNote ? 'Add an internal note…' : 'Type your reply…'}
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
				{#if !isNote}
					<!-- Default first below sm, last above it: on a phone the sheet
					     the design draws leads with the default, and a column reads
					     top-down. -->
					<SendOption
						value="resolve"
						label="Send + resolve"
						disabled={!draft.trim()}
						class="order-2 sm:order-none"
					/>
					<SendOption
						value="keep_open"
						label="Send + keep open"
						disabled={!draft.trim()}
						class="order-3 sm:order-none"
					/>
				{:else if assignees}
					<!-- Its own data, awaited here: the composer is below the fold and
					     the staff list is a whole extra round trip. -->
					{#await assignees() then staffUsers}
						<label class="flex items-center gap-2 text-sm">
							<span class="text-subtle">Assign to</span>
							<Select
								size="sm"
								value={assignTo}
								aria-label="Assign to"
								onchange={(e: Event) => (assignTo = (e.currentTarget as HTMLSelectElement).value)}
							>
								<option value="">Nobody</option>
								{#each staffUsers as s (s.id)}
									<option value={s.id}>{s.name}</option>
								{/each}
							</Select>
						</label>
					{/await}
				{/if}
				<SubmitButton
					label={isNote ? (assignTo ? 'Post note + assign' : 'Add note') : 'Send + wait for reply'}
					successLabel={isNote ? (assignTo ? 'Assigned' : 'Added') : 'Sent'}
					shortcut="mod+enter"
					disabled={!draft.trim()}
					name={isNote ? undefined : 'disposition'}
					value={isNote ? undefined : 'wait'}
					class="{isNote ? 'btn-neutral' : 'btn-primary'} order-1 w-full sm:order-none sm:w-auto"
				>
					{#snippet icon()}
						{#if isNote}<IconNote size={16} />{:else}<IconSend size={16} />{/if}
					{/snippet}
				</SubmitButton>
			</div>
			{#if !isNote}
				<p class="text-right text-subtle text-xs">
					Default. Leaves the queue now and returns the moment they reply — or nudges you in 7 days
					if nothing comes back.
				</p>
			{/if}
		</Form>
	</CardBody>
</div>
