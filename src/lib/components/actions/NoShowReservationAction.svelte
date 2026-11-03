<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
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
	label={m.actions_no_show_reservation_label()}
	modalTitle={m.actions_no_show_reservation_modal_title()}
	submitVariant="warning"
	successToast={m.actions_no_show_reservation_success_toast()}
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
		<p class="text-sm">{m.actions_no_show_reservation_mark_reservation_as_no_show()}</p>
	{/snippet}
</Action>
