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
	import { formatDate } from '#lib/utils/format.js';

	const { fields } = bookAndPayReservation;

	// Bumped when a slot conflict sends the wizard back to step 1, forcing the
	// Date/Time step to reload availability so the just-taken slot disappears.
	let reloadToken = $state(0);

	let {
		isSustaining = false,
		needsPhone = false,
		onbooked
	}: {
		isSustaining?: boolean;
		/** Member has no usable contact number on file — collect one before booking. */
		needsPhone?: boolean;
		onbooked?: () => void;
	} = $props();
</script>

<Action
	action={bookAndPayReservation}
	label={m.member_reserve_space()}
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
			scheduled?: boolean;
			confirmOpensAt?: string;
			redirectUrl?: string;
		};
		if (r?.redirectUrl) {
			await goToCheckout(r.redirectUrl);
		} else {
			if (r?.waitlisted) {
				toast.info(m.member_first_instance_waitlisted_because_slot());
			}
			// Booked outside the window: held, with nothing priced (#2108). Saying so is the point:
			// this outcome used to arrive as a 400 nobody rendered, over a held
			// booking the member was never told about.
			if (r?.scheduled) {
				const opens = r.confirmOpensAt ? formatDate(new Date(r.confirmOpensAt)) : null;
				toast.info(
					opens
						? m.member_reservations_create_modal_room_held_pay_any_time({ opens })
						: m.member_reservations_create_modal_room_held_pay_any_time_2()
				);
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
