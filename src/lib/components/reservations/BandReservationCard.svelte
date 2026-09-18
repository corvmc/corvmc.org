<script lang="ts">
	import { EntityIdentity } from '$lib/components/ui/entity';
	import Form from '$lib/components/ui/Form';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import ReservationCardShell from './ReservationCardShell.svelte';
	import { cancelBandReservation } from '$lib/remote/reservations.remote';
	import { toast } from 'svelte-sonner';
	import type { MemberRef, ReservationRef } from '$lib/types/entity';

	/**
	 * One of the act's own bookings, on the same card the member panel uses.
	 *
	 * The three band-panel lists each drew this by hand as `EntityIdentity` plus
	 * a `StatusBadge` (#566), which is why the badge is gone: the shell already
	 * carries the status, in the date-block tint and the word above it.
	 */
	let {
		reservation,
		slug
	}: {
		reservation: {
			id: string;
			status: string;
			startsAt: Date;
			notes: string | null;
			ref: ReservationRef;
			bookedBy: MemberRef;
			/** Absent on the dashboard list, which offers no controls at all. */
			canCancel?: boolean;
		};
		slug: string;
	} = $props();

	// Read off the form, not the instance below: `.for()` is per-row, but the
	// field descriptors are the same object for every one of them.
	const { fields: cancelFields } = cancelBandReservation;

	const cancel = $derived(cancelBandReservation.for(reservation.id));
	// `canCancel` comes from the server — `cancelBandReservation` authorizes on
	// `createdByUserId`, so rendering it for every bandmate offered a button that
	// answered with an error toast. Nothing is shown to someone who can't.
	const showCancel = $derived(
		reservation.canCancel &&
			(reservation.status === 'scheduled' || reservation.status === 'confirmed')
	);
</script>

<!-- Passed only when it has something in it: the shell's action row straddles
     the bottom border, so an empty one is 20px of dead space under every past
     session and every card on the dashboard. -->
{#snippet cancelAction()}
	<Form remote={cancel} onsuccess={() => toast.success('Reservation cancelled')}>
		<input {...cancelFields.slug.as('hidden', slug)} />
		<input {...cancelFields.reservationId.as('hidden', reservation.id)} />
		<SubmitButton label="Cancel" variant="error" size="xs" outline />
	</Form>
{/snippet}

<ReservationCardShell
	startsAt={reservation.startsAt}
	status={reservation.status}
	actions={showCancel ? cancelAction : undefined}
>
	<div class="p-2 px-3">
		<EntityIdentity ref={reservation.ref} size="md">
			{#snippet subtitle()}
				{reservation.ref.subtitle}
				{#if reservation.bookedBy.id}
					&middot; Booked by {reservation.bookedBy.title}
				{/if}
			{/snippet}
		</EntityIdentity>
		<!-- Its own line, because the subline truncates at `size="md"` and notes
		     were third in it — so the one fact the card adds over the date rail
		     was the one that got clipped (#1051). -->
		{#if reservation.notes}
			<p class="mt-1 text-sm text-base-content/70">{reservation.notes}</p>
		{/if}
	</div>
</ReservationCardShell>
