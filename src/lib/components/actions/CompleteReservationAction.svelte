<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import ReservationSummary from '../reservations/ReservationSummary.svelte';
	import { invalidateAll } from '$app/navigation';
	import { completeReservation } from '#lib/remote/reservations.remote.js';
	const { fields } = completeReservation;

	let {
		reservation,
		variant = 'success',
		size = 'sm',
		class: className = '',
		onsuccess,
		...rest
	}: {
		reservation: { id: string; startsAt: Date; endsAt: Date; memberName?: string };
		variant?: ButtonVariant;
		size?: ButtonSize;
		class?: string;
		onsuccess?: () => void;
		[key: string]: unknown;
	} = $props();
</script>

<Action
	action={completeReservation}
	label={m.actions_complete_reservation_label()}
	modalTitle={m.actions_complete_reservation_modal_title()}
	submitVariant="success"
	successToast={m.actions_complete_reservation_success_toast()}
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => invalidateAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.id.as('hidden', reservation.id)} />
		<ReservationSummary {reservation} />
		<p class="text-sm">{m.actions_complete_reservation_mark_reservation_as_completed()}</p>
	{/snippet}
</Action>
