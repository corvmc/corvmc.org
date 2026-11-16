<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import ReservationSummary from '../reservations/ReservationSummary.svelte';
	import { refreshAll } from '$app/navigation';
	import { cashReceivedReservation } from '#lib/remote/reservations.remote.js';
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
	label={m.actions_cash_received_label()}
	modalTitle={m.actions_cash_received_modal_title()}
	submitVariant="success"
	successToast={m.actions_cash_received_success_toast()}
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
		<p class="text-sm">{m.actions_cash_received_record_cash_was_received_reservation_text()}</p>
	{/snippet}
</Action>
