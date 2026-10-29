<script lang="ts">
	import { resolve } from '$app/paths';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import { formatCents } from '$lib/utils/format';
	import { withQuery } from '$lib/utils/with-query';

	/**
	 * What this show took at the door (#1809): tapped card sales and free
	 * let-ins, from the door's own ticket rows. Door sales have no buyer account,
	 * so they never reach Payments; this card is where staff read them.
	 */
	let {
		eventId,
		takings,
		open
	}: {
		eventId: string;
		takings: { card: { tickets: number; grossCents: number }; free: { tickets: number } };
		/** The till offers this show right now. */
		open: boolean;
	} = $props();

	const total = $derived(takings.card.tickets + takings.free.tickets);
	const tillHref = $derived(
		withQuery(resolve('/member/volunteer/door'), new URLSearchParams({ event: eventId }))
	);
</script>

{#if open || total > 0}
	<InfoCard title="Door Sales" state={total === 0 ? 'None yet' : `${total} admitted`}>
		<div class="flex flex-wrap gap-6">
			<div>
				<p class="text-muted">Card</p>
				<p class="text-lg font-medium">{formatCents(takings.card.grossCents)}</p>
				<p class="text-muted text-sm">
					{takings.card.tickets}
					{takings.card.tickets === 1 ? 'ticket' : 'tickets'}
				</p>
			</div>
			<div>
				<p class="text-muted">Free</p>
				<p class="text-lg font-medium">{takings.free.tickets}</p>
				<p class="text-muted text-sm">let in at no charge</p>
			</div>
		</div>
		<!-- No door refund path exists; a refund is a human in the Stripe dashboard. -->
		<p class="mt-2 text-muted text-sm">
			As sold. Refunds are handled in Stripe and are not reflected here.
		</p>
		{#if open}
			<div class="mt-3">
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- withQuery over resolve() -->
				<a href={tillHref} class="link text-sm link-primary">Open the till →</a>
			</div>
		{/if}
	</InfoCard>
{/if}
