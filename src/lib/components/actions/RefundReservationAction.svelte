<script lang="ts">
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import ReservationSummary from '../reservations/ReservationSummary.svelte';
	import FormField from '../ui/Form/FormField.svelte';
	import { invalidateAll } from '$app/navigation';
	import {
		refundAndCancelReservation,
		refundOnlyReservation
	} from '$lib/remote/reservations.remote';

	let {
		reservation,
		canCancel = true,
		variant = 'error',
		size = 'sm',
		outline = true,
		class: className = '',
		onsuccess,
		...rest
	}: {
		reservation: { id: string; startsAt: Date; endsAt: Date; memberName?: string };
		/** False for a booking `cancel()` refuses (completed): refund only, no box. */
		canCancel?: boolean;
		variant?: ButtonVariant;
		size?: ButtonSize;
		outline?: boolean;
		class?: string;
		onsuccess?: () => void;
		[key: string]: unknown;
	} = $props();

	// The box picks the handler rather than riding the submit as a field: each
	// remote keeps its own schema and spec, and refund-only keeps `paidAt` (#669).
	let alsoCancel = $state(true);
	const cancelling = $derived(canCancel && alsoCancel);
	const action = $derived(cancelling ? refundAndCancelReservation : refundOnlyReservation);
</script>

<Action
	{action}
	label="Refund"
	modalTitle="Refund Payment"
	submitLabel={cancelling ? 'Refund and cancel' : 'Refund'}
	submitVariant="error"
	successToast={cancelling ? 'Payment refunded and reservation cancelled' : 'Payment refunded'}
	{variant}
	{size}
	{outline}
	class={className}
	onsuccess={onsuccess ?? (() => invalidateAll())}
	{...rest}
>
	{#snippet form()}
		<input {...action.fields.id.as('hidden', reservation.id)} />
		<ReservationSummary {reservation} />
		{#if canCancel}
			<FormField
				type="checkbox"
				name="alsoCancel"
				label="Cancellation"
				checkboxLabel="Also cancel this reservation (releases the slot to the waitlist and notifies the member)"
				bind:value={alsoCancel}
			/>
		{/if}
		{#if !cancelling}
			<p class="text-sm">
				The payment is refunded and the booking is not cancelled, for a session that went ahead.
			</p>
		{/if}
	{/snippet}
</Action>
