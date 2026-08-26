<script lang="ts">
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import ReservationSummary from '../reservations/ReservationSummary.svelte';
	import { invalidateAll } from '$app/navigation';
	import { cancelReservation } from '$lib/remote/reservations.remote';
	import type { Reservation } from '$lib/server/reservation';

	let {
		reservation,
		showReasonInput = false,
		variant = 'error',
		size = 'sm',
		outline = true,
		class: className = '',
		onsuccess,
		...rest
	}: {
		reservation: Reservation;
		showReasonInput?: boolean;
		variant?: ButtonVariant;
		size?: ButtonSize;
		outline?: boolean;
		class?: string;
		onsuccess?: () => void;
		[key: string]: unknown;
	} = $props();

	const { fields } = cancelReservation;
</script>

<Action
	action={cancelReservation}
	label="Cancel"
	modalTitle="Cancel Reservation"
	submitVariant="error"
	successToast="Cancelled"
	{variant}
	{size}
	{outline}
	class={className}
	onsuccess={onsuccess ?? (() => invalidateAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.id.as('hidden', reservation.id)} />
		<ReservationSummary {reservation} />
		<p class="text-sm">Are you sure you want to cancel this reservation?</p>
		{#if showReasonInput}
			<input
				{...fields.reason.as('text')}
				placeholder="Reason (optional)"
				class="input w-full input-sm"
			/>
		{/if}
	{/snippet}
</Action>
