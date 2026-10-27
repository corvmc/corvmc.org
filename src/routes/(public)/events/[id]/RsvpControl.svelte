<script lang="ts">
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
	const label = $derived(external ? "I'm going" : 'RSVP');
	const variant = $derived(external ? 'ghost' : 'primary');
</script>

{#if status.state === 'signed-out'}
	<Button requiresAuth="RSVP to {eventTitle}" {variant} size="lg">{label}</Button>
{:else if status.state === 'open'}
	<Form remote={confirmRsvp}>
		<input {...confirmRsvp.fields.eventId.as('hidden', eventId)} />
		<SubmitButton {label} successLabel="You're going" {variant} size="lg" />
	</Form>
	{#if status.attendee}
		<span class="text-muted">as {status.attendee.name}</span>
	{/if}
{:else if status.state === 'going'}
	<span class="text-base font-semibold" data-testid="rsvp-going">You're going!</span>
	<Action
		action={withdrawRsvp}
		label="Can't make it?"
		modalTitle="Cancel RSVP"
		submitLabel="Yes, cancel my RSVP"
		submitVariant="error"
		variant="ghost"
		size="sm"
	>
		{#snippet form()}
			<input {...withdrawRsvp.fields.eventId.as('hidden', eventId)} />
			<p>You can RSVP again any time before the event.</p>
		{/snippet}
	</Action>
{:else if status.reason === 'ticketed'}
	<Button href={resolve(`/events/${eventId}/tickets`)} size="lg">Get tickets</Button>
{:else}
	<span class="text-base font-medium text-fg-2">RSVPs are closed for this event.</span>
{/if}
