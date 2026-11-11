<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import ReservationSummary from '../reservations/ReservationSummary.svelte';
	import { refreshAll } from '$app/navigation';
	import { cancelReservation } from '#lib/remote/reservations.remote.js';
	import type { Reservation } from '#lib/server/reservation/index.js';

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
	label={m.actions_cancel_reservation_label()}
	modalTitle={m.actions_cancel_reservation_modal_title()}
	submitVariant="error"
	successToast={m.actions_cancelled_toast()}
	{variant}
	{size}
	{outline}
	class={className}
	onsuccess={onsuccess ?? (() => refreshAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.id.as('hidden', reservation.id)} />
		<ReservationSummary {reservation} />
		<p class="text-sm">{m.actions_cancel_reservation_sure_want_cancel_reservation_text()}</p>
		{#if showReasonInput}
			<input
				{...fields.reason.as('text')}
				placeholder={m.actions_cancel_reservation_placeholder()}
				class="input w-full input-sm"
			/>
		{/if}
	{/snippet}
</Action>
