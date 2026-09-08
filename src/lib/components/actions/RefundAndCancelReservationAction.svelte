<script lang="ts">
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import ReservationSummary from '../reservations/ReservationSummary.svelte';
	import { invalidateAll } from '$app/navigation';
	import { refundAndCancelReservation } from '$lib/remote/reservations.remote';
	const { fields } = refundAndCancelReservation;

	let {
		reservation,
		variant = 'error',
		size = 'sm',
		outline = true,
		class: className = '',
		onsuccess,
		...rest
	}: {
		reservation: { id: string; startsAt: Date; endsAt: Date; memberName?: string };
		variant?: ButtonVariant;
		size?: ButtonSize;
		outline?: boolean;
		class?: string;
		onsuccess?: () => void;
		[key: string]: unknown;
	} = $props();
</script>

<Action
	action={refundAndCancelReservation}
	label="Refund and cancel"
	modalTitle="Refund and Cancel"
	submitVariant="error"
	successToast="Payment refunded and reservation cancelled"
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
		<p class="text-sm">
			Refund the payment and cancel this reservation? The slot is released to the waitlist and the
			member is notified.
		</p>
	{/snippet}
</Action>
