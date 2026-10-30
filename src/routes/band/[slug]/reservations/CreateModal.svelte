<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { IconCalendarPlus } from '@tabler/icons-svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import DateTimeStep from '$lib/components/reservations/booking/DateTimeStep.svelte';
	import ConfirmStep from '$lib/components/reservations/booking/ConfirmStep.svelte';
	import PaymentStep from '$lib/components/reservations/booking/PaymentStep.svelte';
	import { bookBandReservation } from '$lib/remote/reservations.remote';
	import { goToCheckout } from '$lib/utils/checkout-navigation';

	/**
	 * Booking the practice space for a band.
	 *
	 * Replaces a 280-line `/reservations/new` page that hand-rolled its own slot
	 * arithmetic, its own `div.fieldset` markup, and a price of
	 * `hours × rate` that never consulted `getReservationPricing` — so the
	 * booking member's own free hours were invisible until after the fact.
	 *
	 * The member wizard's steps, payment included: Pay Ahead charges the booker
	 * after their own free hours (#2095); Book leaves it owed, payable later by
	 * any member of the act.
	 *
	 * `BookingConflict` is also absent: it keys on a `{ conflict: true }` result
	 * that only `bookAndPayReservation` returns. Giving the band flow the same
	 * recovery is worth doing, but it changes this remote's contract, so it is
	 * its own change.
	 */
	let {
		slug,
		hasSustainingMember = false,
		needsPhone = false
	}: {
		/** The band this books for — the ref the guard resolves. */
		slug: string;
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
	maxWidth="max-w-sm"
	onsuccess={async (result) => {
		const r = result as { waitlisted?: boolean; redirectUrl?: string } | undefined;
		if (r?.redirectUrl) {
			await goToCheckout(r.redirectUrl);
		} else if (r?.waitlisted) {
			toast.info('The first instance is waitlisted because the slot is currently booked.');
		} else {
			toast.success('Session booked');
		}
	}}
>
	{#snippet icon()}<IconCalendarPlus size={18} />{/snippet}
	{#snippet form()}
		<input {...bookBandReservation.fields.slug.as('hidden', slug)} />
		<DateTimeStep isSustaining={hasSustainingMember} {needsPhone} />
		<ConfirmStep band />
		<PaymentStep
			fields={{ coverFees: bookBandReservation.fields.coverFees }}
			submit={bookBandReservation.fields.payNow.as('submit', 'on')}
		/>
	{/snippet}
</Action>
