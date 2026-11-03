<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import ReservationSummary from '../reservations/ReservationSummary.svelte';
	import FormField from '../ui/Form/FormField.svelte';
	import { invalidateAll } from '$app/navigation';
	import {
		refundAndCancelReservation,
		refundOnlyReservation
	} from '#lib/remote/reservations.remote.js';

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
	label={m.actions_refund_reservation_refund()}
	modalTitle={m.actions_refund_reservation_modal_title()}
	submitLabel={cancelling
		? m.actions_refund_reservation_refund_cancel()
		: m.actions_refund_reservation_refund()}
	submitVariant="error"
	successToast={cancelling
		? m.actions_refund_reservation_payment_refunded_reservation_canc()
		: m.actions_refund_reservation_payment_refunded()}
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
				label={m.actions_refund_reservation_cancellation()}
				checkboxLabel={m.actions_refund_reservation_checkbox_label()}
				bind:value={alsoCancel}
			/>
		{/if}
		{#if !cancelling}
			<p class="text-sm" data-testid="refund-only-note">
				{m.actions_refund_reservation_payment_refunded_booking_not_canc()}
			</p>
		{/if}
	{/snippet}
</Action>
