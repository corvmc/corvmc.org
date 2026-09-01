<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { IconSchool } from '@tabler/icons-svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import DateTimeStep from '$lib/components/reservations/booking/DateTimeStep.svelte';
	import ConfirmStep from '$lib/components/reservations/booking/ConfirmStep.svelte';
	import { bookInstructorReservation } from '$lib/remote/reservations.remote';

	/**
	 * Booking the room to teach.
	 *
	 * A **second button rather than a mode inside the rehearsal wizard**, which is
	 * a deviation from the plan and deliberate. `Action` binds one remote form, so
	 * a booking-type step would have meant restructuring the wizard to swap its
	 * action mid-flight — and the two are not variants of one booking anyway: they
	 * have different rates, different duration floors, different advance windows,
	 * and settle differently. Two buttons say that; a hidden toggle would not.
	 *
	 * Modelled on the band modal for the same reason it gives: `PaymentStep` is
	 * absent because `bookInstructorReservation` takes no payment, so a payment
	 * step would charge nobody and show a receipt for it. Teaching time settles
	 * like a band session does.
	 *
	 * `isSustaining` is passed `true` unconditionally, and that is not a lie about
	 * the member — it is what unlocks the recurring option in `DateTimeStep`, and
	 * teaching genuinely has no sustaining-membership gate. Requiring a
	 * subscription on top of a staff grant would mean staff granting something the
	 * member cannot use.
	 */
	let { needsPhone = false, onbooked }: { needsPhone?: boolean; onbooked?: () => void } = $props();
</script>

<Action
	action={bookInstructorReservation}
	label="Book teaching time"
	modalTitle="Book teaching time"
	noFooter
	variant="ghost"
	maxWidth="max-w-md"
	onsuccess={(result) => {
		const r = result as { waitlisted?: boolean } | undefined;
		if (r?.waitlisted) {
			toast.info('The first instance is waitlisted because the slot is currently booked.');
		} else {
			toast.success('Teaching time booked');
		}
		onbooked?.();
	}}
>
	{#snippet icon()}<IconSchool size={18} />{/snippet}
	{#snippet form()}
		<DateTimeStep isSustaining {needsPhone} bookerType="instructor" />
		<!--
			`payAhead={false}` because `bookInstructorReservation` takes no payment:
			Pay Ahead advances to a payment step this modal does not have. Teaching
			time settles at the door, the way a band session does.
		-->
		<ConfirmStep bookerType="instructor" payAhead={false} />
	{/snippet}
</Action>
