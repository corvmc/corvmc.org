<script lang="ts">
	import Action from '../Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../Button.svelte';
	import { invalidateAll } from '$app/navigation';
	import { payForReservation, confirmReservation } from '$lib/remote/reservations.remote';
	import ConfirmStep from '../reservations/booking/ConfirmStep.svelte';
	import PaymentStep from '../reservations/booking/PaymentStep.svelte';

	let {
		reservation,
		staff = false,
		variant = 'success',
		size = 'sm',
		class: className = '',
		onsuccess,
		...rest
	}: {
		reservation: { id: string; startsAt: Date; endsAt: Date };
		// Staff confirming on a member's behalf: submit confirmReservation (commits
		// the OWNER's credits) and skip the member-only online Pay Ahead step.
		staff?: boolean;
		variant?: ButtonVariant;
		size?: ButtonSize;
		class?: string;
		onsuccess?: () => void;
		[key: string]: unknown;
	} = $props();

	const action = $derived(staff ? confirmReservation : payForReservation);
</script>

<Action
	{action}
	label="Confirm"
	modalTitle="Confirm Reservation"
	noFooter
	maxWidth="max-w-md"
	successToast="Confirmed"
	{variant}
	{size}
	class={className}
	onsuccess={async (result) => {
		const r = result as { paid?: boolean; confirmed?: boolean; redirectUrl?: string };
		if (r?.redirectUrl) {
			window.location.href = r.redirectUrl;
		} else {
			if (onsuccess) onsuccess();
			else await invalidateAll();
		}
	}}
	{...rest}
>
	{#snippet form()}
		{#if staff}
			<ConfirmStep {reservation} fields={{ id: confirmReservation.fields.id }} staff />
		{:else}
			<ConfirmStep {reservation} fields={{ id: payForReservation.fields.id }} />
			<PaymentStep
				{reservation}
				fields={{ id: payForReservation.fields.id, coverFees: payForReservation.fields.coverFees }}
			/>
		{/if}
	{/snippet}
</Action>
