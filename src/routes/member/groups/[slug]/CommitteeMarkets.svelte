<script lang="ts">
	import { resolve } from '$app/paths';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import { formatDateShort } from '$lib/utils/format';
	import { getCommitteeMarkets } from '$lib/remote/market.remote';

	/** Market days the committee's projects own. Its members decide their vendors (#1503). */
	let { groupId, slug }: { groupId: string; slug: string } = $props();

	const markets = $derived(await getCommitteeMarkets(groupId));
</script>

{#if markets.length > 0}
	<InfoCard title="Market days">
		<Table>
			{#snippet head()}
				<th>Market</th>
				<th>Date</th>
				<th><span class="sr-only">Vendors</span></th>
			{/snippet}
			{#each markets as market (market.eventId)}
				<tr>
					<td class="cell-primary">{market.title}</td>
					<td>{formatDateShort(market.startsAt)}</td>
					<td class="text-right">
						<a class="link" href={resolve(`/member/groups/${slug}/markets/${market.eventId}`)}>
							Vendors
						</a>
						{#if market.toReview > 0}
							<Badge variant="warning" size="sm">{market.toReview} to review</Badge>
						{/if}
					</td>
				</tr>
			{/each}
		</Table>
	</InfoCard>
{/if}
