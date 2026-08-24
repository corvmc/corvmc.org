<script lang="ts">
	import Action from '../Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../Button.svelte';
	import ReservationSummary from '../reservations/ReservationSummary.svelte';
	import { invalidateAll } from '$app/navigation';
	import { confirmWaitlisted } from '$lib/remote/reservations.remote';
	import { formatDate } from '$lib/utils/format';
	import type { Reservation } from '$lib/server/reservation';

	let {
		reservation,
		variant = 'success',
		size = 'sm',
		class: className = '',
		onsuccess,
		...rest
	}: {
		reservation: Reservation;
		variant?: ButtonVariant;
		size?: ButtonSize;
		class?: string;
		onsuccess?: () => void;
		[key: string]: unknown;
	} = $props();

	const { fields } = confirmWaitlisted;
</script>

<Action
	action={confirmWaitlisted}
	label="Confirm Slot"
	modalTitle="Confirm Waitlisted Reservation"
	submitLabel="Confirm Reservation"
	submitVariant="success"
	successToast="Reservation confirmed"
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => invalidateAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.id.as('hidden', reservation.id)} />
		<ReservationSummary {reservation} />
		<p class="text-sm">
			A slot has opened up for this time. Would you like to confirm this reservation?
		</p>
		{#if reservation.waitlistExpiresAt}
			<p class="text-subtle">
				You have until {formatDate(reservation.waitlistExpiresAt)} to confirm before the slot is offered
				to someone else.
			</p>
		{/if}
	{/snippet}
</Action>
