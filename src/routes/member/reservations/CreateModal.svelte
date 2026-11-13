<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { toast } from 'svelte-sonner';
	import { bookAndPayReservation } from '#lib/remote/reservations.remote.js';
	import { goToCheckout } from '#lib/utils/checkout-navigation.js';
	import Action from '#lib/components/ui/Action.svelte';
	import { IconCalendarPlus } from '@tabler/icons-svelte';
	import DateTimeStep from '#lib/components/reservations/booking/DateTimeStep.svelte';
	import ConfirmStep from '#lib/components/reservations/booking/ConfirmStep.svelte';
	import PaymentStep from '#lib/components/reservations/booking/PaymentStep.svelte';
	import BookingConflict from '#lib/components/reservations/booking/BookingConflict.svelte';
	import PaymentDue, { type FeeGate } from '#lib/components/reservations/booking/PaymentDue.svelte';

	const { fields } = bookAndPayReservation;

	// Bumped when a slot conflict sends the wizard back to step 1, forcing the
	// Date/Time step to reload availability so the just-taken slot disappears.
	let reloadToken = $state(0);

	let {
		isSustaining = false,
		needsPhone = false,
		feeGate,
		onbooked
	}: {
		isSustaining?: boolean;
		/** Member has no usable contact number on file — collect one before booking. */
		needsPhone?: boolean;
		/** Outstanding fees (#2859): one swaps the booking form for `PaymentDue`. */
		feeGate?: FeeGate;
		onbooked?: () => void;
	} = $props();
</script>

{#if feeGate?.state === 'refuse'}
	<PaymentDue gate={feeGate} label={m.member_reserve_space_label()} data-testid="book-space">
		{#snippet icon()}<IconCalendarPlus size={18} />{/snippet}
	</PaymentDue>
{:else}
	<Action
		action={bookAndPayReservation}
		label={m.member_reserve_space_label()}
		data-testid="book-space"
		modalTitle={m.member_reservations_create_modal_modal_title()}
		noFooter
		variant="primary"
		maxWidth="max-w-sm"
		onsuccess={async (result) => {
			const r = result as {
				reservationId?: string;
				paid?: boolean;
				confirmed?: boolean;
				waitlisted?: boolean;
				redirectUrl?: string;
			};
			if (r?.redirectUrl) {
				await goToCheckout(r.redirectUrl);
			} else {
				if (r?.waitlisted) {
					toast.info(m.member_first_instance_waitlisted_because_slot_toast());
				}
				onbooked?.();
			}
		}}
	>
		{#snippet icon()}<IconCalendarPlus size={18} />{/snippet}
		{#snippet form()}
			<DateTimeStep {isSustaining} {needsPhone} {reloadToken} />
			<ConfirmStep submitLabel={m.member_reservations_create_modal_submit_label()} />
			<PaymentStep fields={{ coverFees: fields.coverFees }} />
			<BookingConflict result={bookAndPayReservation.result} onconflict={() => reloadToken++} />
		{/snippet}
	</Action>
{/if}
