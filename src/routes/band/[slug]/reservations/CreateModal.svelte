<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { IconCalendarPlus } from '@tabler/icons-svelte';
	import Action from '$lib/components/shared/Action.svelte';
	import DateTimeStep from '$lib/components/shared/reservations/booking/DateTimeStep.svelte';
	import ConfirmStep from '$lib/components/shared/reservations/booking/ConfirmStep.svelte';
	import { bookBandReservation } from '$lib/remote/reservations.remote';

	/**
	 * Booking the practice space for a band.
	 *
	 * Replaces a 280-line `/reservations/new` page that hand-rolled its own slot
	 * arithmetic, its own `div.form-control` markup, and a price of
	 * `hours × rate` that never consulted `getReservationPricing` — so the
	 * booking member's own free hours were invisible until after the fact.
	 *
	 * The member wizard's first two steps do this already. Its third does not:
	 * `bookBandReservation` is a plain form that takes no payment, unlike
	 * `bookAndPayReservation`, so a PaymentStep here would charge nobody and show
	 * a receipt for it. Band sessions settle at the door, as they always have.
	 *
	 * `BookingConflict` is also absent: it keys on a `{ conflict: true }` result
	 * that only `bookAndPayReservation` returns. Giving the band flow the same
	 * recovery is worth doing, but it changes this remote's contract, so it is
	 * its own change.
	 */
	let {
		hasSustainingMember = false,
		needsPhone = false
	}: {
		/** Unlocks recurring series — at least one active member must be sustaining. */
		hasSustainingMember?: boolean;
		/** The person booking has no usable number on file; staff need one to call. */
		needsPhone?: boolean;
	} = $props();
</script>

<Action
	action={bookBandReservation}
	label="Book a Session"
	modalTitle="Book a Session"
	noFooter
	variant="primary"
	size="sm"
	maxWidth="max-w-md"
	onsuccess={(result) => {
		const r = result as { waitlisted?: boolean } | undefined;
		if (r?.waitlisted) {
			toast.info('The first instance is waitlisted because the slot is currently booked.');
		} else {
			toast.success('Session booked');
		}
	}}
>
	{#snippet icon()}<IconCalendarPlus size={18} />{/snippet}
	{#snippet form()}
		<DateTimeStep isSustaining={hasSustainingMember} {needsPhone} />
		<ConfirmStep band />
	{/snippet}
</Action>
