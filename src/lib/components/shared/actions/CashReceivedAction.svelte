<script lang="ts">
	import Action from '../Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../Button.svelte';
	import ReservationSummary from '../reservations/ReservationSummary.svelte';
	import { invalidateAll } from '$app/navigation';
	import { cashReceivedReservation } from '$lib/remote/reservations.remote';
	const { fields } = cashReceivedReservation;

	let {
		reservation,
		variant = 'success',
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
	action={cashReceivedReservation}
	label="Cash received"
	modalTitle="Record Cash Payment"
	submitVariant="success"
	successToast="Marked as paid"
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
		<p class="text-sm">Record that cash was received for this reservation?</p>
	{/snippet}
</Action>
