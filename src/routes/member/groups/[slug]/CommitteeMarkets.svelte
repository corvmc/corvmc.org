<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import { formatDateShort } from '#lib/utils/format.js';
	import { getCommitteeMarkets } from '#lib/remote/market.remote.js';

	/** Market days the committee's projects own. Its members decide their vendors (#1503). */
	let { groupId, slug }: { groupId: string; slug: string } = $props();

	const markets = $derived(await getCommitteeMarkets(groupId));
</script>

{#if markets.length > 0}
	<InfoCard title={m.member_groups_slug_committee_markets_title()}>
		<Table>
			{#snippet head()}
				<th>{m.member_groups_slug_committee_markets_market_label()}</th>
				<th>{m.member_date_label()}</th>
				<th><span class="sr-only">{m.member_vendors_label()}</span></th>
			{/snippet}
			{#each markets as market (market.eventId)}
				<tr>
					<td class="cell-primary">{market.title}</td>
					<td>{formatDateShort(market.startsAt)}</td>
					<td class="text-right">
						<a class="link" href={resolve(`member/groups/${slug}/markets/${market.eventId}`)}>
							{m.member_vendors_text()}
						</a>
						{#if market.toReview > 0}
							<Badge variant="warning" size="sm"
								>{m.member_groups_slug_committee_markets_review_label({
									toReview: market.toReview
								})}</Badge
							>
						{/if}
					</td>
				</tr>
			{/each}
		</Table>
	</InfoCard>
{/if}
