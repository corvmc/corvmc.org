<script lang="ts">
	/**
	 * Status controls for one thread: resolve, reopen, snooze, awaiting reply.
	 *
	 * This replaced a `<select>` + "Update Status" button, which took two
	 * interactions to do the one thing anyone does from here. Each action is its
	 * own single-purpose form so it gets `SubmitButton`'s spinner and success flash
	 * — the forms are `display: contents` so their buttons still lay out as one row.
	 */
	import type { RemoteForm } from '@sveltejs/kit';
	import { addDays, format, nextMonday } from 'date-fns';
	import {
		IconAlarmSnooze,
		IconCheck,
		IconRotate,
		IconInbox,
		IconSend
	} from '@tabler/icons-svelte';
	import Form from '$lib/components/shared/Form/Form.svelte';
	import FormField from '$lib/components/shared/Form/FormField.svelte';
	import SubmitButton from '$lib/components/shared/Form/SubmitButton.svelte';
	import Action from '$lib/components/shared/Action.svelte';
	import { formatDate } from '$lib/utils/format';

	type StatusInput = {
		threadId: string;
		status: 'open' | 'resolved' | 'snoozed';
		snoozedUntil?: string;
	};
	/** What `.for(key)` returns — a form instance with its own pending state. */
	type StatusFormInstance = Omit<RemoteForm<StatusInput, unknown>, 'for'>;
	type AwaitingInput = { threadId: string; awaiting: 'true' | 'false' };

	let {
		threadId,
		status,
		snoozedUntil,
		awaitingReplySince,
		resolveForm,
		reopenForm,
		snoozeForm,
		awaitingForm
	}: {
		threadId: string;
		status: 'open' | 'resolved' | 'snoozed';
		snoozedUntil?: Date | null;
		/** Set while we are waiting on the contact — see thread-status.ts. */
		awaitingReplySince?: Date | null;
		/** Separate instances so each button tracks its own pending state. */
		resolveForm: StatusFormInstance;
		reopenForm: StatusFormInstance;
		/** `Action` needs the full form (it renders its own `<Form>`). */
		snoozeForm: RemoteForm<StatusInput, unknown>;
		awaitingForm: Omit<RemoteForm<AwaitingInput, unknown>, 'for'>;
	} = $props();

	// Values are the dates themselves, so picking a preset *is* picking a date and
	// the server never has to re-derive "next Monday" from a label.
	const snoozeOptions = $derived.by(() => {
		const now = new Date();
		return [
			{ label: 'Tomorrow', date: addDays(now, 1) },
			{ label: 'In 3 days', date: addDays(now, 3) },
			{ label: 'Next Monday', date: nextMonday(now) },
			{ label: 'In two weeks', date: addDays(now, 14) }
		].map(({ label, date }) => ({
			value: format(date, 'yyyy-MM-dd'),
			label: `${label} — ${formatDate(date)}`
		}));
	});

	let snoozeDate = $state('');
</script>

<div class="flex flex-wrap gap-2">
	{#if status !== 'resolved'}
		<Form remote={resolveForm} successToast="Marked resolved" class="contents">
			<input {...resolveForm.fields.threadId.as('hidden', threadId)} />
			<input {...resolveForm.fields.status.as('hidden', 'resolved')} />
			<SubmitButton label="Resolve" successLabel="Resolved" variant="primary" size="sm">
				{#snippet icon()}<IconCheck size={16} />{/snippet}
			</SubmitButton>
		</Form>
	{/if}

	{#if status !== 'open'}
		<Form remote={reopenForm} successToast="Reopened" class="contents">
			<input {...reopenForm.fields.threadId.as('hidden', threadId)} />
			<input {...reopenForm.fields.status.as('hidden', 'open')} />
			<SubmitButton
				label={status === 'snoozed' ? 'Unsnooze' : 'Reopen'}
				successLabel="Reopened"
				variant="default"
				size="sm"
			>
				{#snippet icon()}<IconRotate size={16} />{/snippet}
			</SubmitButton>
		</Form>
	{/if}

	<!--
		Replying sets this by itself; the button is for the conversation that was
		answered off the platform, and for taking a marked thread back.
	-->
	{#if awaitingReplySince}
		<Form remote={awaitingForm} successToast="Back in the queue" class="contents">
			<input {...awaitingForm.fields.threadId.as('hidden', threadId)} />
			<input {...awaitingForm.fields.awaiting.as('hidden', 'false')} />
			<SubmitButton label="Needs a reply" successLabel="Back in queue" variant="ghost" size="sm">
				{#snippet icon()}<IconInbox size={16} />{/snippet}
			</SubmitButton>
		</Form>
	{:else if status === 'open'}
		<Form remote={awaitingForm} successToast="Marked awaiting reply" class="contents">
			<input {...awaitingForm.fields.threadId.as('hidden', threadId)} />
			<input {...awaitingForm.fields.awaiting.as('hidden', 'true')} />
			<SubmitButton label="Awaiting reply" successLabel="Awaiting reply" variant="ghost" size="sm">
				{#snippet icon()}<IconSend size={16} />{/snippet}
			</SubmitButton>
		</Form>
	{/if}

	{#if status !== 'snoozed'}
		<Action
			action={snoozeForm}
			label="Snooze"
			modalTitle="Snooze conversation"
			submitLabel="Snooze"
			successToast="Snoozed"
			variant="ghost"
			size="sm"
			maxWidth="max-w-sm"
		>
			{#snippet icon()}<IconAlarmSnooze size={16} />{/snippet}
			{#snippet form()}
				<input {...snoozeForm.fields.threadId.as('hidden', threadId)} />
				<input {...snoozeForm.fields.status.as('hidden', 'snoozed')} />
				<p class="text-muted">It leaves the open queue and returns on the morning you pick.</p>
				<FormField
					name="snoozedUntil"
					label="Bring it back"
					type="select"
					placeholder="Choose when…"
					options={snoozeOptions}
					bind:value={snoozeDate}
				/>
			{/snippet}
		</Action>
	{/if}
</div>

{#if status === 'snoozed' && snoozedUntil}
	<p class="flex items-center gap-1.5 text-muted">
		<IconAlarmSnooze size={14} />
		Returns {formatDate(new Date(snoozedUntil))}
	</p>
{:else if awaitingReplySince}
	<p class="flex items-center gap-1.5 text-muted">
		<IconSend size={14} />
		Waiting on a reply since {formatDate(new Date(awaitingReplySince))}
	</p>
{/if}
