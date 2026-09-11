<script lang="ts">
	import { formatDistanceToNow } from 'date-fns';
	import {
		formatMonthDayYear,
		formatTimeRange,
		formatDateShortYear,
		formatDuration
	} from '$lib/utils/format';

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
			paidAt?: Date | null;
			refundedAt?: Date | null;
			creditsAvailable?: boolean;
			waitlistExpiresAt?: Date | null;
		};
		member?: { name: string };
		class?: string;
	} = $props();

	// Promoted, not merely queued: the offer exists and has not lapsed.
	const offered = $derived(
		reservation.status === 'waitlisted' &&
			!!reservation.waitlistExpiresAt &&
			reservation.waitlistExpiresAt.getTime() > Date.now()
	);
</script>

<div class={className}>
	<p class="font-medium">{formatMonthDayYear(reservation.startsAt)}</p>
	<p class="text-muted">
		{formatTimeRange(reservation.startsAt, reservation.endsAt)} · {formatDuration(
			reservation.startsAt,
			reservation.endsAt
		)}
	</p>
	{#if offered}
		<!-- A promoted waitlist entry is an offer with a clock on it, and nothing
		     is owed on it yet. The money line here said "$30.00 · Due in 14 days"
		     off the session date while the offer expired in 24 hours — the one
		     deadline that mattered, contradicted by the only line that named
		     one (#1005). -->
		<p class="font-medium text-success">A slot opened up</p>
		<p class="text-muted">
			Confirm by {formatMonthDayYear(reservation.waitlistExpiresAt!)}, {formatDistanceToNow(
				reservation.waitlistExpiresAt!,
				{ addSuffix: true }
			)}, or it goes to the next person.
		</p>
	{:else if reservation.price === 0}
		<p class="text-muted">Covered by credits</p>
	{:else if reservation.price != null}
		<p class="text-muted">
			{reservation.price.toLocaleString(undefined, { style: 'currency', currency: 'USD' })} ·
			{#if reservation.refundedAt}
				Refunded {formatDateShortYear(reservation.refundedAt)}
			{:else if reservation.paidAt}
				Paid {formatDateShortYear(reservation.paidAt)}
			{:else if reservation.status === 'cancelled'}
				Payment Cancelled
			{:else if reservation.status === 'completed' || reservation.status === 'no_show'}
				<!-- Session is over but the balance was never settled. -->
				<span class="font-medium text-error">Overdue</span>
			{:else}
				<!-- Stays date-fns: a distance between two instants has no timezone to
				     get wrong, and there is no venue-time equivalent because there is
				     nothing to equivalise. -->
				Due {formatDistanceToNow(reservation.startsAt, { addSuffix: true })}
			{/if}
		</p>
	{/if}
	{#if reservation.creditsAvailable}
		<p class="text-sm font-medium text-success">Free hours available — applied at checkout</p>
	{/if}
	{#if member?.name}
		<p class="text-muted">{member.name}</p>
	{/if}
</div>
