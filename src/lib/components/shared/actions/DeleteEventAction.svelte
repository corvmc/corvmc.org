<script lang="ts">
	import Button from '../Button.svelte';
	import Action from '../Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../Button.svelte';
	import Alert from '../Alert.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { deleteEvent, getEventDeletionImpact } from '$lib/remote/events.remote';

	const { fields } = deleteEvent;

	let {
		eventId,
		variant = 'error',
		size = 'sm',
		class: className = '',
		onsuccess,
		...rest
	}: {
		eventId: string;
		variant?: ButtonVariant;
		size?: ButtonSize;
		class?: string;
		onsuccess?: () => void;
		[key: string]: unknown;
	} = $props();

	// Loaded up front rather than on open: the button itself has to know whether
	// this event is deletable at all, and a disabled control that explains why is
	// kinder than one that fails after the click.
	const impact = $derived(await getEventDeletionImpact(eventId));
</script>

{#if impact.deletable}
	<Action
		action={deleteEvent}
		label="Delete"
		modalTitle="Delete this event?"
		submitLabel="Delete permanently"
		submitVariant="error"
		successToast="Event deleted"
		{variant}
		{size}
		class={className}
		onsuccess={onsuccess ?? (() => goto(resolve('/staff/events')))}
		{...rest}
	>
		{#snippet form()}
			<input {...fields.id.as('hidden', eventId)} />
			<p class="py-2">
				This removes the event outright. Use it for something that shouldn't exist — a test row, a
				duplicate, a spam listing.
			</p>
			<p class="pb-2">
				If the show was real and isn't happening, <strong>cancel</strong> it instead: that keeps it on
				the calendar marked cancelled so anyone who had the date finds out.
			</p>

			{#if impact.rsvpCount > 0 || impact.lineupCount > 0 || impact.hasReservation}
				<Alert type="warning">
					Deleting also removes:
					<ul class="mt-1 list-inside list-disc">
						{#if impact.rsvpCount > 0}
							<li>{impact.rsvpCount} RSVP{impact.rsvpCount === 1 ? '' : 's'}</li>
						{/if}
						{#if impact.lineupCount > 0}
							<li>
								{impact.lineupCount} lineup credit{impact.lineupCount === 1 ? '' : 's'} — the show disappears
								from those bands' profiles
							</li>
						{/if}
						{#if impact.hasReservation}
							<li>the space booking is released</li>
						{/if}
					</ul>
				</Alert>
			{/if}

			<p class="pt-2 text-muted">This cannot be undone.</p>
		{/snippet}
	</Action>
{:else}
	<!-- Rendered as a disabled control rather than hidden: "why can't I delete
	     this?" is a question worth answering in place. -->
	<Button
		{variant}
		{size}
		class={className}
		disabled
		title="Events with tickets can't be deleted — cancel it instead, which voids the tickets and tells the people holding them."
	>
		Delete
	</Button>
{/if}
