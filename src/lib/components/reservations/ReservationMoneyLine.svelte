<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { formatDistanceToNow } from 'date-fns';
	import { formatDateShortYear } from '#lib/utils/format.js';
	import type { ReservationTrack } from '#lib/utils/reservation-actions.js';

	/** A booking's amount and the date beside it, on the member's and the band's list cards (#3131). */
	let {
		price,
		track,
		startsAt,
		paidAt,
		refundedAt
	}: {
		/** Dollars owed: the stored remainder once committed, else the full rate. */
		price: number;
		track: ReservationTrack | null;
		startsAt: Date;
		paidAt: Date | null;
		refundedAt: Date | null;
	} = $props();
</script>

{#if price === 0}
	<p class="text-muted">{m.reservations_reservation_summary_covered_by_credits_text()}</p>
{:else}
	<p class="text-muted" data-testid="reservation-amount">
		{price.toLocaleString(undefined, { style: 'currency', currency: 'USD' })}
		<!-- The card's badge names the track; this adds only the date it lacks. -->
		{#if track === 'refunded' && refundedAt}
			· {m.reservations_reservation_summary_refunded_text({
				formatDateShortYear: formatDateShortYear(refundedAt)
			})}
		{:else if track === 'paid' && paidAt}
			· {m.reservations_reservation_summary_paid_text({
				formatDateShortYear: formatDateShortYear(paidAt)
			})}
		{:else if track === 'booked'}
			<!-- Stays date-fns: a distance between two instants has no timezone to
			     get wrong. -->
			· {m.reservations_reservation_summary_due_text({
				formatDistanceToNow: formatDistanceToNow(startsAt, { addSuffix: true })
			})}
		{/if}
	</p>
{/if}
