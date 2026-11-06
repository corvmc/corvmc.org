<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import ReservationSummary from '../reservations/ReservationSummary.svelte';
	import { refreshAll } from '$app/navigation';
	import { compReservation } from '#lib/remote/reservations.remote.js';
	const { fields } = compReservation;

	let {
		reservation,
		variant = 'info',
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
	action={compReservation}
	label={m.actions_comp_reservation_label()}
	modalTitle={m.actions_comp_reservation_modal_title()}
	submitVariant="info"
	successToast={m.actions_comp_reservation_success_toast()}
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
		<p class="text-sm">{m.actions_comp_reservation_waive_payment_reservation()}</p>
	{/snippet}
</Action>
