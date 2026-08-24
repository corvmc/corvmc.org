<script lang="ts">
	import Action from '../Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../Button.svelte';
	import ReservationSummary from '../reservations/ReservationSummary.svelte';
	import { invalidateAll } from '$app/navigation';
	import { payForReservation } from '$lib/remote/reservations.remote';
	import PaymentStep from '../reservations/booking/PaymentStep.svelte';
	import type { Reservation } from '$lib/server/reservation';

	const { fields } = payForReservation;

	let {
		reservation,
		label = 'Pay Now',
		variant = 'primary',
		size = 'sm',
		class: className = '',
		...rest
	}: {
		reservation: Reservation;
		label?: string;
		variant?: ButtonVariant;
		size?: ButtonSize;
		class?: string;
		[key: string]: unknown;
	} = $props();
</script>

<Action
	action={payForReservation}
	{label}
	modalTitle="Pay for Your Session"
	noFooter
	maxWidth="max-w-md"
	{variant}
	{size}
	class={className}
	onsuccess={async (result) => {
		const r = result as { paid?: boolean; redirectUrl?: string };
		if (r?.redirectUrl) {
			window.location.href = r.redirectUrl;
		} else {
			await invalidateAll();
		}
	}}
	{...rest}
>
	{#snippet form()}
		<ReservationSummary {reservation} />
		<PaymentStep
			{reservation}
			fields={{ id: fields.id, coverFees: fields.coverFees }}
			precedingSteps={0}
		/>
	{/snippet}
</Action>
