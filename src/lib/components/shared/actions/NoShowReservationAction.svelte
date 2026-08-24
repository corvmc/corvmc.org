<script lang="ts">
	import Action from '../Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../Button.svelte';
	import ReservationSummary from '../reservations/ReservationSummary.svelte';
	import { invalidateAll } from '$app/navigation';
	import { noShowReservation } from '$lib/remote/reservations.remote';
	const { fields } = noShowReservation;

	let {
		reservation,
		variant = 'warning',
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
	action={noShowReservation}
	label="No-Show"
	modalTitle="Mark as No-Show"
	submitVariant="warning"
	successToast="Marked as no-show"
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
		<p class="text-sm">Mark this reservation as a no-show?</p>
	{/snippet}
</Action>
