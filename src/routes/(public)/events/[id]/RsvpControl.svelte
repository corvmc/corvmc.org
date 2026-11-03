<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import Button from '$lib/components/ui/Button.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import Form, { SubmitButton } from '$lib/components/ui/Form';
	import { getRsvpStatus, confirmRsvp, withdrawRsvp } from '$lib/remote/event-rsvp.remote';

	/**
	 * The event page's RSVP (#1995), the first consumer of the sign-in interrupt
	 * (#1999). Signed out, the button is the interrupt and returns here; back
	 * here signed in it is one tap. Nothing writes until that tap.
	 */
	let {
		eventId,
		eventTitle,
		external = false
	}: { eventId: string; eventTitle: string; external?: boolean } = $props();

	const status = $derived(await getRsvpStatus(eventId));
	const label = $derived(
		external ? m.public_events_id_rsvp_control_i_m_going() : m.public_events_id_rsvp_control_rsvp()
	);
	const variant = $derived(external ? 'ghost' : 'primary');
</script>

{#if status.state === 'signed-out'}
	<Button requiresAuth="RSVP to {eventTitle}" {variant} size="lg">{label}</Button>
{:else if status.state === 'open'}
	<Form remote={confirmRsvp}>
		<input {...confirmRsvp.fields.eventId.as('hidden', eventId)} />
		<SubmitButton
			{label}
			successLabel={m.public_events_id_rsvp_control_success_label()}
			{variant}
			size="lg"
		/>
	</Form>
	{#if status.attendee}
		<span class="text-muted"
			>{m.public_events_id_rsvp_control_as({ name: status.attendee.name })}</span
		>
	{/if}
{:else if status.state === 'going'}
	<span class="text-base font-semibold" data-testid="rsvp-going"
		>{m.public_events_id_rsvp_control_re_going()}</span
	>
	<Action
		action={withdrawRsvp}
		label={m.public_events_id_rsvp_control_label()}
		modalTitle={m.public_events_id_rsvp_control_modal_title()}
		submitLabel={m.public_events_id_rsvp_control_submit_label()}
		submitVariant="error"
		variant="ghost"
		size="sm"
	>
		{#snippet form()}
			<input {...withdrawRsvp.fields.eventId.as('hidden', eventId)} />
			<p>{m.public_events_id_rsvp_control_can_rsvp_again_any_time()}</p>
		{/snippet}
	</Action>
{:else if status.reason === 'ticketed'}
	<Button href={resolve(`/events/${eventId}/tickets`)} size="lg"
		>{m.public_events_id_rsvp_control_get_tickets()}</Button
	>
{:else}
	<span class="text-base font-medium text-fg-2"
		>{m.public_events_id_rsvp_control_rsvps_closed_event()}</span
	>
{/if}
