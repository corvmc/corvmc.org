<script lang="ts">
	import { resolve } from '$app/paths';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import CompTicketsAction from '$lib/components/actions/CompTicketsAction.svelte';
	import { formatCents } from '$lib/utils/format';
	import { priceDisplay } from '$lib/utils/event-ticketing';

	/**
	 * A listing's sale as staff monitor it: price, capacity, sold and remaining,
	 * where the money went, comps and the ticket list (#1949). The sale terms are
	 * edited in `ListingEditForm`. Comps are CMC's own sales only: a band selling
	 * its gig (#1203) is watched here, not comped.
	 */
	let {
		event,
		ticketStats,
		ticketMoney: money,
		tickets,
		onchange
	}: {
		event: {
			id: string;
			status: string;
			source: string;
			ticketingEnabled: boolean;
			ticketPrice: number | null;
			ticketPriceFloorCents: number | null;
			ticketQuantity: number | null;
			externalTicketUrl: string | null;
		};
		ticketStats: { sold: number; remaining: number | null } | null;
		ticketMoney: {
			ticketsCents: number;
			contributionsCents: number;
			feeCoveredCents: number;
			actsCents: number;
			collectiveCents: number;
			freeCount: number;
			paidCount: number;
		} | null;
		tickets: {
			id: string;
			attendeeName: string;
			attendeeEmail: string;
			code: string;
			status: string;
			unitPriceCents: number | null;
			contributionCents: number;
			actsCents: number;
			collectiveCents: number;
			discountWaived: boolean;
		}[];
		onchange?: () => void;
	} = $props();

	// What Stripe took: everything collected, less what the buyers directed.
	const cardCents = $derived(
		money
			? money.ticketsCents +
					money.contributionsCents +
					money.feeCoveredCents -
					money.actsCents -
					money.collectiveCents
			: 0
	);
	const canComp = $derived(event.source === 'cmc' && event.status !== 'cancelled');
</script>

{#if event.ticketingEnabled || event.ticketPrice}
	<InfoCard title="Ticketing">
		<div class="flex flex-wrap gap-6">
			<div>
				<p class="text-muted">Price</p>
				<p class="text-lg font-medium">{priceDisplay(event).label}</p>
			</div>
			<div>
				<p class="text-muted">Sold by</p>
				<p class="text-lg font-medium">
					{event.ticketingEnabled ? 'Us' : event.externalTicketUrl ? 'Off-site' : 'At the door'}
				</p>
			</div>
			{#if event.ticketingEnabled}
				<div>
					<p class="text-muted">Capacity</p>
					<p class="text-lg font-medium">{event.ticketQuantity ?? 'Unlimited'}</p>
				</div>
			{/if}
			{#if ticketStats}
				<div>
					<p class="text-muted">Sold</p>
					<p class="text-lg font-medium">{ticketStats.sold}</p>
				</div>
				<div>
					<p class="text-muted">Remaining</p>
					<p class="text-lg font-medium">{ticketStats.remaining ?? '∞'}</p>
				</div>
			{/if}
			{#if money && money.contributionsCents > 0}
				<div>
					<p class="text-muted">Contributions</p>
					<p class="text-lg font-medium">{formatCents(money.contributionsCents)}</p>
				</div>
			{/if}
			{#if money && money.freeCount > 0}
				<!-- A $0-floor show can sell out on tickets nobody paid for. -->
				<div>
					<p class="text-muted">Free / paid</p>
					<p class="text-lg font-medium">{money.freeCount} / {money.paidCount}</p>
				</div>
			{/if}
		</div>

		{#if money && (money.actsCents > 0 || money.collectiveCents > 0)}
			<div class="mt-4 border-t border-base-200 pt-4">
				<p class="text-muted">Where buyers sent it</p>
				<div class="mt-2 flex flex-wrap gap-6">
					<div>
						<p class="text-muted">To the bands</p>
						<p class="text-lg font-medium">{formatCents(money.actsCents)}</p>
					</div>
					<div>
						<p class="text-muted">To the Collective</p>
						<p class="text-lg font-medium">{formatCents(money.collectiveCents)}</p>
					</div>
					<div>
						<p class="text-muted">Card processing</p>
						<p class="text-lg font-medium">{formatCents(cardCents)}</p>
					</div>
				</div>
				<!-- Refunds are a human in the Stripe dashboard, which nothing here sees. -->
				<p class="mt-2 text-muted text-sm">
					As sold. Refunds are handled in Stripe and are not reflected here.
				</p>
			</div>
		{/if}

		{#if event.status === 'published' && event.ticketingEnabled}
			<div class="mt-3">
				<a
					href={resolve(`/events/${event.id}/tickets`)}
					class="link text-sm link-primary"
					target="_blank"
				>
					View purchase page →
				</a>
			</div>
		{/if}

		{#if canComp}
			<div class="mt-4 border-t border-base-200 pt-4">
				<CompTicketsAction eventId={event.id} onsuccess={onchange} />
			</div>
		{/if}
	</InfoCard>

	{#if tickets.length > 0}
		<InfoCard title="Tickets ({tickets.length})">
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">Status</span></th>
					<th>Attendee</th>
					<th class="w-px text-right">Paid</th>
					<th class="w-px">Code</th>
				{/snippet}
				{#each tickets as t (t.id)}
					<tr class="hover">
						<td class="w-px"><StatusBadge status={t.status} /></td>
						<td class="cell-primary">
							<div class="truncate font-medium">{t.attendeeName}</div>
							<div class="truncate text-muted">{t.attendeeEmail}</div>
						</td>
						<td class="w-px text-right whitespace-nowrap">
							<div class="font-medium">
								{t.unitPriceCents === null ? '—' : formatCents(t.unitPriceCents)}
							</div>
							{#if t.contributionCents > 0}
								<div class="text-sm text-success">
									+{formatCents(t.contributionCents)} contributed
								</div>
							{/if}
							{#if t.actsCents > 0 || t.collectiveCents > 0}
								<!-- Order-level: on the purchase's first row only, and labelled so. -->
								<div class="text-muted text-sm">
									order → bands {formatCents(t.actsCents)} · collective {formatCents(
										t.collectiveCents
									)}
								</div>
							{/if}
							{#if t.discountWaived}
								<div class="text-muted">Waived discount</div>
							{/if}
						</td>
						<td class="w-px"><span class="font-mono text-sm">{t.code}</span></td>
					</tr>
				{/each}
			</Table>
		</InfoCard>
	{/if}
{/if}
