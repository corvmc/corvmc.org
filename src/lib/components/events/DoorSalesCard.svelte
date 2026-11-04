<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import { formatCents } from '#lib/utils/format.js';
	import { withQuery } from '#lib/utils/with-query.js';

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
		withQuery(resolve('member/volunteer/door'), new URLSearchParams({ event: eventId }))
	);
</script>

{#if open || total > 0}
	<InfoCard
		title={m.events_door_sales_card_title()}
		state={total === 0 ? 'None yet' : `${total} admitted`}
	>
		<div class="flex flex-wrap gap-6">
			<div>
				<p class="text-muted">{m.events_door_sales_card_card()}</p>
				<p class="text-lg font-medium">{formatCents(takings.card.grossCents)}</p>
				<p class="text-muted text-sm">
					{takings.card.tickets}
					{takings.card.tickets === 1
						? m.events_door_sales_card_ticket()
						: m.events_door_sales_card_tickets()}
				</p>
			</div>
			<div>
				<p class="text-muted">{m.events_free()}</p>
				<p class="text-lg font-medium">{takings.free.tickets}</p>
				<p class="text-muted text-sm">{m.events_door_sales_card_let_at_no_charge()}</p>
			</div>
		</div>
		<!-- No door refund path exists; a refund is a human in the Stripe dashboard. -->
		<p class="mt-2 text-muted text-sm">
			{m.events_as_sold_refunds_handled_stripe()}
		</p>
		{#if open}
			<div class="mt-3">
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- withQuery over resolve() -->
				<a href={tillHref} class="link text-sm link-primary"
					>{m.events_door_sales_card_open_till()}</a
				>
			</div>
		{/if}
	</InfoCard>
{/if}
