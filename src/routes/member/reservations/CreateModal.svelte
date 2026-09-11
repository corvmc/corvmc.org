<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { bookAndPayReservation } from '$lib/remote/reservations.remote';
	import Action from '$lib/components/ui/Action.svelte';
	import { IconCalendarPlus } from '@tabler/icons-svelte';
	import DateTimeStep from '$lib/components/reservations/booking/DateTimeStep.svelte';
	import ConfirmStep from '$lib/components/reservations/booking/ConfirmStep.svelte';
	import PaymentStep from '$lib/components/reservations/booking/PaymentStep.svelte';
	import BookingConflict from '$lib/components/reservations/booking/BookingConflict.svelte';
	import { formatDate } from '$lib/utils/format';

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
	label="Reserve Space"
	modalTitle="Book a Session"
	noFooter
	variant="primary"
	maxWidth="max-w-md"
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
			window.location.href = r.redirectUrl;
		} else {
			if (r?.waitlisted) {
				toast.info('The first instance is waitlisted because the slot is currently booked.');
			}
			// Booked too far out to commit free hours yet. Saying so is the point:
			// this outcome used to arrive as a 400 nobody rendered, over a held
			// booking the member was never told about.
			if (r?.scheduled) {
				const opens = r.confirmOpensAt ? formatDate(new Date(r.confirmOpensAt)) : null;
				toast.info(
					opens
						? `Room held. Confirm it from ${opens} to spend your free hours.`
						: 'Room held. Confirm it closer to the date to spend your free hours.'
				);
			}
			onbooked?.();
		}
	}}
>
	{#snippet icon()}<IconCalendarPlus size={18} />{/snippet}
	{#snippet form()}
		<DateTimeStep {isSustaining} {needsPhone} {reloadToken} />
		<ConfirmStep />
		<PaymentStep fields={{ coverFees: fields.coverFees }} />
		<BookingConflict result={bookAndPayReservation.result} onconflict={() => reloadToken++} />
	{/snippet}
</Action>
