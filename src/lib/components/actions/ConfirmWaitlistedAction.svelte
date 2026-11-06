<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import ReservationSummary from '../reservations/ReservationSummary.svelte';
	import { refreshAll } from '$app/navigation';
	import { confirmWaitlisted } from '#lib/remote/reservations.remote.js';
	import { formatDate } from '#lib/utils/format.js';
	import type { Reservation } from '#lib/server/reservation/index.js';

	let {
		reservation,
		variant = 'success',
		size = 'sm',
		class: className = '',
		onsuccess,
		...rest
	}: {
		reservation: Reservation;
		variant?: ButtonVariant;
		size?: ButtonSize;
		class?: string;
		onsuccess?: () => void;
		[key: string]: unknown;
	} = $props();

	const { fields } = confirmWaitlisted;
</script>

<Action
	action={confirmWaitlisted}
	label={m.actions_confirm_waitlisted_label()}
	modalTitle={m.actions_confirm_waitlisted_modal_title()}
	submitLabel={m.actions_confirm_reservation()}
	submitVariant="success"
	successToast={m.actions_confirm_waitlisted_success_toast()}
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => refreshAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.id.as('hidden', reservation.id)} />
		<ReservationSummary {reservation} />
		<p class="text-sm">
			{m.actions_confirm_waitlisted_slot_has_opened_up_time()}
		</p>
		{#if reservation.waitlistExpiresAt}
			<p class="text-subtle">
				{m.actions_confirm_waitlisted_have_until_confirm_before_slot({
					formatDate: formatDate(reservation.waitlistExpiresAt)
				})}
			</p>
		{/if}
	{/snippet}
</Action>
