<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { formatDollars } from '#lib/utils/format.js';
	import type { ReservationTrack, TrackDetail } from '#lib/utils/reservation-actions.js';

	/** Where the money stands, in one sentence; shared by both reservation detail pages (#3131). */
	let {
		track,
		trackDetail,
		cashDueCents
	}: {
		track: ReservationTrack;
		trackDetail: TrackDetail | null;
		cashDueCents: number | null;
	} = $props();
</script>

{#if track === 'refunded'}
	<p data-payment-state="refunded">{m.reservations_payment_state_refunded_text()}</p>
{:else if track === 'paid'}
	<p data-payment-state="paid">{m.reservations_payment_state_paid_full_text()}</p>
{:else if track === 'covered'}
	<p data-payment-state="covered">{m.reservations_payment_state_settled_text()}</p>
{:else if trackDetail === 'cash_due'}
	<p data-payment-state="cash_due" class="font-medium">
		<!-- After the session the door is no longer where it gets paid. -->
		{(track === 'payment_due'
			? m.reservations_payment_state_due_text
			: m.reservations_payment_state_due_at_door_text)({
			formatDollars: formatDollars(cashDueCents ?? 0)
		})}
	</p>
{:else if trackDetail === 'unpriced'}
	<p data-payment-state="unpriced">{m.reservations_payment_state_not_yet_paid_text()}</p>
{/if}
