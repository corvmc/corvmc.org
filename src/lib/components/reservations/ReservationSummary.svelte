<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { formatDistanceToNow } from 'date-fns';
	import { formatMonthDayYear, formatTimeRange, formatDuration } from '#lib/utils/format.js';
	import { reservationTrack } from '#lib/utils/reservation-actions.js';
	import ReservationMoneyLine from './ReservationMoneyLine.svelte';

	let {
		reservation,
		member,
		class: className = ''
	}: {
		reservation: {
			startsAt: Date;
			endsAt: Date;
			price?: number;
			status?: string;
			bookerType?: string;
			cashDueCents?: number | null;
			paidAt?: Date | null;
			refundedAt?: Date | null;
			waitlistExpiresAt?: Date | null;
		};
		member?: { name: string };
		class?: string;
	} = $props();

	// The money line follows the track; a caller without the columns gets the price alone.
	const track = $derived(
		reservation.status && reservation.bookerType
			? reservationTrack({
					status: reservation.status,
					bookerType: reservation.bookerType,
					endsAt: reservation.endsAt,
					paidAt: reservation.paidAt ?? null,
					refundedAt: reservation.refundedAt ?? null,
					cashDueCents: reservation.cashDueCents ?? null
				})
			: null
	);

	// Promoted, not merely queued: the offer exists and has not lapsed.
	const offered = $derived(
		reservation.status === 'waitlisted' &&
			!!reservation.waitlistExpiresAt &&
			reservation.waitlistExpiresAt.getTime() > Date.now()
	);
</script>

<div class={className}>
	<!-- No date line: the shell's rail already says Sat / 3 / May beside this,
	     and the only thing the second copy added was the year — which is worth a
	     word only when it is not this one (#1043). -->
	<p class="font-medium">
		{formatTimeRange(reservation.startsAt, reservation.endsAt)}
		{#if reservation.startsAt.getFullYear() !== new Date().getFullYear()}
			<span class="text-muted font-normal">{reservation.startsAt.getFullYear()}</span>
		{/if}
	</p>
	<p class="text-muted">
		{formatDuration(reservation.startsAt, reservation.endsAt)}
	</p>
	{#if offered}
		<!-- A promoted waitlist entry is an offer with a clock on it, and nothing
		     is owed on it yet. The money line here said "$30.00 · Due in 14 days"
		     off the session date while the offer expired in 24 hours — the one
		     deadline that mattered, contradicted by the only line that named
		     one (#1005). -->
		<p class="font-medium text-success">
			{m.reservations_reservation_summary_slot_opened_up_text()}
		</p>
		<p class="text-muted">
			{m.reservations_reservation_summary_confirm_by_goes_next_person_text({
				formatMonthDayYear: formatMonthDayYear(reservation.waitlistExpiresAt!),
				formatDistanceToNow: formatDistanceToNow(reservation.waitlistExpiresAt!, {
					addSuffix: true
				})
			})}
		</p>
	{:else if reservation.price != null}
		<ReservationMoneyLine
			price={reservation.price}
			{track}
			startsAt={reservation.startsAt}
			paidAt={reservation.paidAt ?? null}
			refundedAt={reservation.refundedAt ?? null}
		/>
	{/if}
	{#if member?.name}
		<p class="text-muted">{member.name}</p>
	{/if}
</div>
