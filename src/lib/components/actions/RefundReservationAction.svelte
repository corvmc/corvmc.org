<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import ReservationSummary from '../reservations/ReservationSummary.svelte';
	import FormField from '../ui/Form/FormField.svelte';
	import { refreshAll } from '$app/navigation';
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
	label={m.actions_refund_reservation_refund_label()}
	modalTitle={m.actions_refund_reservation_modal_title()}
	submitLabel={cancelling
		? m.actions_refund_reservation_refund_cancel_label()
		: m.actions_refund_reservation_refund_label()}
	submitVariant="error"
	successToast={cancelling
		? m.actions_refund_reservation_payment_refunded_reservation_canc_toast()
		: m.actions_refund_reservation_payment_refunded_toast()}
	{variant}
	{size}
	{outline}
	class={className}
	onsuccess={onsuccess ?? (() => refreshAll())}
	{...rest}
>
	{#snippet form()}
		<input {...action.fields.id.as('hidden', reservation.id)} />
		<ReservationSummary {reservation} />
		{#if canCancel}
			<FormField
				type="checkbox"
				label={m.actions_refund_reservation_cancellation_label()}
				checkboxLabel={m.actions_refund_reservation_checkbox_label_checkbox()}
				bind:value={alsoCancel}
			/>
		{/if}
		{#if !cancelling}
			<p class="text-sm" data-testid="refund-only-note">
				{m.actions_refund_reservation_payment_refunded_booking_not_canc_text()}
			</p>
		{/if}
	{/snippet}
</Action>
