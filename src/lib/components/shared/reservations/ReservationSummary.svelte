<script lang="ts">
	import { format, formatDistanceToNow } from 'date-fns';

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
		};
		member?: { name: string };
		class?: string;
	} = $props();

	let durationHours = $derived(
		(reservation.endsAt.getTime() - reservation.startsAt.getTime()) / (1000 * 60 * 60)
	);

	function formatHours(h: number): string {
		const value = Number.isInteger(h) ? h : Number(h.toFixed(1));
		return `${value} ${value === 1 ? 'hour' : 'hours'}`;
	}
</script>

<div class={className}>
	<p class="font-medium">{format(reservation.startsAt, 'PPP')}</p>
	<p class="text-muted">
		{format(reservation.startsAt, 'p')} – {format(reservation.endsAt, 'p')} · {formatHours(
			durationHours
		)}
	</p>
	{#if reservation.price === 0}
		<p class="text-muted">Covered by credits</p>
	{:else if reservation.price != null}
		<p class="text-muted">
			{reservation.price.toLocaleString(undefined, { style: 'currency', currency: 'USD' })} ·
			{#if reservation.refundedAt}
				Refunded {format(reservation.refundedAt, 'PP')}
			{:else if reservation.paidAt}
				Paid {format(reservation.paidAt, 'PP')}
			{:else if reservation.status === 'cancelled'}
				Payment Cancelled
			{:else if reservation.status === 'completed' || reservation.status === 'no_show'}
				<!-- Session is over but the balance was never settled. -->
				<span class="font-medium text-error">Overdue</span>
			{:else}
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
