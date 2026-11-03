<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import Button from '../ui/Button.svelte';
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import Alert from '../ui/Alert.svelte';
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
		label={m.actions_delete()}
		modalTitle={m.actions_delete_event_modal_title()}
		submitLabel={m.actions_delete_event_submit_label()}
		submitVariant="error"
		successToast={m.actions_delete_event_success_toast()}
		{variant}
		{size}
		class={className}
		onsuccess={onsuccess ?? (() => goto(resolve('/staff/events')))}
		data-testid="delete-event"
		{...rest}
	>
		{#snippet form()}
			<input {...fields.id.as('hidden', eventId)} />
			<p class="py-2">
				{m.actions_delete_event_removes_event_outright_use_something()}
			</p>
			<p class="pb-2">
				<ParaglideMessage message={m.actions_delete_event_if_show_was_real_isn} inputs={{}}
					>{#snippet strong({ children })}<strong>{@render children?.()}</strong
						>{/snippet}</ParaglideMessage
				>
			</p>

			{#if impact.rsvpCount > 0 || impact.lineupCount > 0 || impact.hasReservation}
				<Alert type="warning">
					{m.actions_delete_event_deleting_also_removes()}
					<ul class="mt-1 list-inside list-disc">
						{#if impact.rsvpCount > 0}
							<li>
								{m.actions_delete_event_rsvp({
									rsvpCount: impact.rsvpCount,
									value: impact.rsvpCount === 1 ? '' : 's'
								})}
							</li>
						{/if}
						{#if impact.lineupCount > 0}
							<li>
								{m.actions_delete_event_lineup_credit_show_disappears_from({
									lineupCount: impact.lineupCount,
									value: impact.lineupCount === 1 ? '' : 's'
								})}
							</li>
						{/if}
						{#if impact.hasReservation}
							<li>{m.actions_delete_event_space_booking_released()}</li>
						{/if}
					</ul>
				</Alert>
			{/if}

			<p class="pt-2 text-muted">{m.actions_delete_event_cannot_undone()}</p>
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
		data-testid="delete-event"
		title={m.actions_delete_event_title()}
	>
		{m.actions_delete()}
	</Button>
{/if}
